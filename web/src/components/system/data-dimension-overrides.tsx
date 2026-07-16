/**
 * 按功能覆盖 · 数据权限配置列表（P2，permission-center.md 附3 用户参考图形态；磐石 V54 并行）。
 *
 * 行式覆盖列表：[+ 添加资源] → 每行 功能下拉 × 维度下拉（内建「组织(部门)」+ 启用业务维度）
 * × 范围（全部数据/指定）× 值选择器（dept→OrgPicker 部门树多选 chips；业务维→选项多选）× 删除。
 * 同功能可多行（不同维度，维度间 AND）；已覆盖功能行头提示「该功能已脱离全局配置」（覆盖=替换）。
 *
 * 保存（Tab 内独立按钮，照 P3 字段权限 Tab 先例）：**按层替换**（V54 终稿）——按 feature
 * 分组逐层 PUT ?feature=X（body 不带 feature）；快照里有、现列表没有的层 → PUT [] 清空
 * （该功能回落全局）。回显走 GET ?all=1（全局行过滤不入列表）。dirty 经 onDirtyChange
 * 并入 Tab 未保存拦截，resetSignal 回滚快照。角色/用户同构（principalType 参数化）。
 * 部门维值选择支持「连同子部门」辅助勾选（勾选时展开成显式 deptId 集，精确集语义不变）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { CloudOff, Info, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RecordPicker, RecordPickerField, type RecordPickerColumn } from "@/components/record-picker"
import { OrgPicker } from "@/components/org-picker"
import { ErrorBoundary } from "@/components/error-boundary"
import { fetchAiFeatures, type AiFeatureItem } from "@/lib/field-perms"
import { api } from "@/lib/api"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DEPT_DIMENSION,
  fetchAuthzAll,
  fetchDimensionOptions,
  fetchDimensions,
  isGlobalRow,
  saveAuthz,
  type DataDimension,
  type DimAuthz,
  type DimOption,
  type DimScope,
  type DpPrincipal,
} from "./dp-authz-api"

interface OverrideRow {
  uid: number
  feature: string
  dimension: string
  scope: DimScope
  values: number[]
}

const optionColumns: RecordPickerColumn<DimOption>[] = [{ key: "label", title: "名称" }]

/** 部门树节点（/api/system/depts/tree） */
interface DeptNode {
  id: number
  name: string
  children?: DeptNode[]
}

/** 扁平化：每个部门 → 其全部后代（含名称，供「连同子部门」展开为显式 id 集） */
function buildDescendantsMap(tree: DeptNode[]): Map<number, { id: number; name: string }[]> {
  const map = new Map<number, { id: number; name: string }[]>()
  const collect = (node: DeptNode): { id: number; name: string }[] => {
    const own: { id: number; name: string }[] = []
    for (const c of node.children ?? []) {
      own.push({ id: c.id, name: c.name }, ...collect(c))
    }
    map.set(node.id, own)
    return own
  }
  for (const root of tree) collect(root)
  return map
}

let uidSeq = 1

/** 快照序列化（dirty 比对）：按内容排序，与行顺序无关 */
function serializeRows(rows: OverrideRow[]): string {
  return JSON.stringify(
    rows
      .map((r) => ({ feature: r.feature, dimension: r.dimension, scope: r.scope, values: [...r.values].sort((a, b) => a - b) }))
      .sort((a, b) => `${a.feature}:${a.dimension}`.localeCompare(`${b.feature}:${b.dimension}`)),
  )
}

function toRows(list: DimAuthz[]): OverrideRow[] {
  return list
    .filter((a) => !isGlobalRow(a))
    .map((a) => ({
      uid: uidSeq++,
      feature: a.feature ?? "",
      dimension: a.dimension,
      scope: a.scope === "CUSTOM" ? "CUSTOM" : ("ALL" as DimScope),
      values: Array.isArray(a.values) ? a.values : [],
    }))
}

export function DataDimensionOverrides({
  principalType,
  id,
  canEdit,
  onDirtyChange,
  resetSignal,
}: {
  principalType: DpPrincipal
  id: number
  canEdit: boolean
  /** dirty 上报（并入调用方 Tab 未保存拦截）；可不传（如用户编辑弹窗独立使用） */
  onDirtyChange?: (dirty: boolean) => void
  /** 递增触发回滚到已保存快照（Tab「丢弃并切换」） */
  resetSignal?: number
}) {
  const [features, setFeatures] = useState<AiFeatureItem[]>([])
  const [dims, setDims] = useState<DataDimension[]>([])
  const [rows, setRows] = useState<OverrideRow[]>([])
  const [snapshot, setSnapshot] = useState<string>(serializeRows([]))
  const snapshotRowsRef = useRef<OverrideRow[]>([])
  const [optionsMap, setOptionsMap] = useState<Record<string, DimOption[]>>({})
  const [nameMap, setNameMap] = useState<Record<string, string>>({}) // `${dimension}:${id}` → label（dept 与业务维共用）
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [demo, setDemo] = useState(false)
  const [pickerFor, setPickerFor] = useState<number | null>(null) // 业务维 RecordPicker（row uid）
  const [deptPickerFor, setDeptPickerFor] = useState<number | null>(null) // 部门 OrgPicker（row uid）
  // 「连同子部门」辅助勾选（可选增强）：确认部门选择时把每个所选部门展开为其子树显式 id 集（精确集语义不变）
  const [withChildren, setWithChildren] = useState(false)
  const descendantsRef = useRef<Map<number, { id: number; name: string }[]> | null>(null)
  const ensureDeptTree = useCallback(() => {
    if (descendantsRef.current) return
    void api<DeptNode[]>("/api/system/depts/tree")
      .then((tree) => {
        descendantsRef.current = buildDescendantsMap(Array.isArray(tree) ? tree : [])
      })
      .catch(() => undefined) // 树拉不到 → 勾选不展开（仍是精确所选集），不阻断
  }, [])

  /** 维度下拉目录：内建「组织(部门)」置顶 + 启用的业务维度（P1 目录动态来，含用户自建） */
  const dimCatalog = useMemo<DataDimension[]>(
    () => [{ code: DEPT_DIMENSION, label: "组织(部门)", enabled: true }, ...dims.filter((d) => d.enabled !== false)],
    [dims],
  )
  const dimLabel = useCallback(
    (code: string) => dimCatalog.find((d) => d.code === code)?.label ?? code,
    [dimCatalog],
  )
  const valueName = useCallback(
    (dimension: string, v: number) => nameMap[`${dimension}:${v}`] ?? (dimension === DEPT_DIMENSION ? `部门#${v}` : `#${v}`),
    [nameMap],
  )

  const ensureOptions = useCallback((code: string) => {
    if (code === DEPT_DIMENSION) return // dept 走 OrgPicker 部门树
    setOptionsMap((cur) => {
      if (cur[code]) return cur
      void fetchDimensionOptions(code)
        .then((r) => {
          const opts = Array.isArray(r.data) ? r.data : []
          setOptionsMap((m) => ({ ...m, [code]: opts }))
          setNameMap((m) => {
            const next = { ...m }
            opts.forEach((o) => (next[`${code}:${o.id}`] = o.label))
            return next
          })
        })
        .catch(() => undefined)
      return cur
    })
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([fetchAiFeatures(), fetchDimensions(), fetchAuthzAll(principalType, id)])
      .then(([featRes, dimsRes, authzRes]) => {
        setFeatures(Array.isArray(featRes.data) ? featRes.data : [])
        setDims(Array.isArray(dimsRes.data) ? dimsRes.data : [])
        const loaded = toRows(Array.isArray(authzRes.data) ? authzRes.data : [])
        setRows(loaded)
        snapshotRowsRef.current = loaded
        setSnapshot(serializeRows(loaded))
        setDemo(featRes.demo || dimsRes.demo || authzRes.demo)
        loaded.filter((r) => r.scope === "CUSTOM").forEach((r) => ensureOptions(r.dimension))
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "功能级数据权限加载失败"))
      .finally(() => setLoading(false))
  }, [principalType, id, ensureOptions])
  useEffect(() => {
    load()
  }, [load])

  // dirty 上报（内容级比对，与行顺序无关）
  const dirty = serializeRows(rows) !== snapshot
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // 丢弃回滚：还原到已保存快照
  const firstReset = useRef(true)
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false
      return
    }
    setRows(snapshotRowsRef.current)
  }, [resetSignal])

  const patchRow = (uid: number, patch: Partial<OverrideRow>) =>
    setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)))

  const addRow = () => setRows((rs) => [...rs, { uid: uidSeq++, feature: "", dimension: "", scope: "ALL", values: [] }])

  /** 已被覆盖的功能集合（用于下拉标记 + 行头「脱离全局」提示） */
  const coveredFeatures = useMemo(() => new Set(rows.filter((r) => r.feature).map((r) => r.feature)), [rows])
  const featureName = useCallback(
    (code: string) => features.find((f) => f.featureCode === code)?.name ?? code,
    [features],
  )

  const save = async () => {
    for (const r of rows) {
      if (!r.feature || !r.dimension) {
        toast.error("有覆盖行未选择功能或维度，请补全后保存")
        return
      }
      if (r.scope === "CUSTOM" && r.values.length === 0) {
        toast.error(`「${featureName(r.feature)} · ${dimLabel(r.dimension)}」选择了指定范围，请至少选一个值`)
        return
      }
    }
    const dup = rows.find((r, i) => rows.some((x, j) => j < i && x.feature === r.feature && x.dimension === r.dimension))
    if (dup) {
      toast.error(`「${featureName(dup.feature)}」的「${dimLabel(dup.dimension)}」维度配置了多行，请合并为一行`)
      return
    }
    setSaving(true)
    try {
      // 按层替换（V54 终稿）：按 feature 分组逐层 PUT（body 不带 feature，以 query 为准）
      const byFeature = new Map<string, DimAuthz[]>()
      for (const r of rows) {
        const list = byFeature.get(r.feature) ?? []
        list.push({ dimension: r.dimension, scope: r.scope, values: r.scope === "CUSTOM" ? r.values : [] })
        byFeature.set(r.feature, list)
      }
      // 快照里有、现列表没有的层 → PUT [] 清空（该功能回落全局）
      for (const f of new Set(snapshotRowsRef.current.map((r) => r.feature))) {
        if (f && !byFeature.has(f)) byFeature.set(f, [])
      }
      for (const [feature, list] of byFeature) {
        await saveAuthz(principalType, id, list, feature)
      }
      snapshotRowsRef.current = rows
      setSnapshot(serializeRows(rows))
      toast.success(`已保存按功能覆盖（${rows.length} 行，${byFeature.size} 个功能层）`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="py-6 text-center text-muted-foreground">
        <Loader2 className="mx-auto size-4 animate-spin" />
      </div>
    )
  }

  const pickerRow = rows.find((r) => r.uid === pickerFor)
  const deptRow = rows.find((r) => r.uid === deptPickerFor)

  return (
    <ErrorBoundary label="dp-overrides">
      <div className="space-y-2.5">
        {demo && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            <CloudOff className="size-3.5 shrink-0" />
            后端不可达——当前为<strong>演示数据</strong>，可完整走通配置。
          </div>
        )}

        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
            暂无按功能覆盖——所有功能走上方默认权限（全局）。点击「添加资源」为某个功能单独收窄/放开数据范围。
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.uid} className="rounded-md border p-2.5">
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
                  {/* 功能（资源）下拉：已覆盖功能标记 */}
                  <Select value={row.feature} onValueChange={(v) => patchRow(row.uid, { feature: v })} disabled={!canEdit}>
                    <SelectTrigger className="h-8 w-full text-xs" aria-label="选择功能">
                      <SelectValue placeholder="选择功能（资源）" />
                    </SelectTrigger>
                    <SelectContent>
                      {features.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">功能目录为空</div>
                      ) : (
                        features.map((f) => (
                          <SelectItem key={f.featureCode} value={f.featureCode} className="text-xs">
                            <span className="flex items-center gap-1.5">
                              {f.name}
                              <span className="font-mono text-[10px] text-muted-foreground">{f.featureCode}</span>
                              {coveredFeatures.has(f.featureCode) && f.featureCode !== row.feature && (
                                <Badge variant="outline" className="h-4 px-1 text-[10px]">已覆盖</Badge>
                              )}
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>

                  {/* 维度下拉：内建 组织(部门) + 启用业务维度（P1 目录动态来） */}
                  <Select
                    value={row.dimension}
                    onValueChange={(v) => {
                      patchRow(row.uid, { dimension: v, values: [] })
                      if (row.scope === "CUSTOM") ensureOptions(v)
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="h-8 w-full text-xs" aria-label="选择维度">
                      <SelectValue placeholder="选择维度" />
                    </SelectTrigger>
                    <SelectContent>
                      {dimCatalog.map((d) => (
                        <SelectItem key={d.code} value={d.code} className="text-xs">
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* 范围：全部数据 / 指定 */}
                  <Select
                    value={row.scope}
                    onValueChange={(v) => {
                      patchRow(row.uid, { scope: v as DimScope, values: v === "CUSTOM" ? row.values : [] })
                      if (v === "CUSTOM" && row.dimension) ensureOptions(row.dimension)
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="h-8 w-28 text-xs" aria-label="选择范围">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL" className="text-xs">全部数据</SelectItem>
                      <SelectItem value="CUSTOM" className="text-xs">指定</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="删除覆盖行"
                    className="size-8 text-muted-foreground hover:text-rose-500"
                    disabled={!canEdit}
                    onClick={() => setRows((rs) => rs.filter((r) => r.uid !== row.uid))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                {/* 指定 → 值选择器按维度出：dept=部门树多选；业务维=选项多选 */}
                {row.scope === "CUSTOM" && row.dimension && (
                  <div className="mt-2 space-y-1.5">
                    <RecordPickerField
                      labels={row.values.map((v) => ({ id: String(v), label: valueName(row.dimension, v) }))}
                      placeholder={row.dimension === DEPT_DIMENSION ? "选择部门（多选，值为部门 id 精确集）" : "选择可见范围（多选）"}
                      multiple
                      onOpen={() => {
                        if (row.dimension === DEPT_DIMENSION) {
                          ensureDeptTree()
                          setDeptPickerFor(row.uid)
                        } else {
                          ensureOptions(row.dimension)
                          setPickerFor(row.uid)
                        }
                      }}
                      onRemove={(vid) => patchRow(row.uid, { values: row.values.filter((x) => String(x) !== vid) })}
                    />
                    {row.dimension === DEPT_DIMENSION && (
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Checkbox checked={withChildren} onCheckedChange={(v) => setWithChildren(v === true)} aria-label="连同子部门" disabled={!canEdit} />
                        连同子部门（确认选择时展开为子部门显式 id 集）
                      </label>
                    )}
                  </div>
                )}

                {/* 覆盖提示：该功能脱离全局（覆盖=替换，不与全局并集） */}
                {row.feature && (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3 shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent>覆盖=替换：该功能只看本覆盖层，不再与全局配置取并集（多角色之间仍取并集放宽）。</TooltipContent>
                    </Tooltip>
                    「{featureName(row.feature)}」已脱离全局配置
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!canEdit} onClick={addRow}>
            <Plus className="size-3.5" /> 添加资源
          </Button>
          {canEdit && (
            <Button size="sm" className="gap-1.5" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 保存按功能覆盖
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          同一功能可配多行（不同维度，维度间同时生效）；解析顺序：功能覆盖 &gt; 全局 &gt; 不限。部门维先按「精确部门集」语义（子树语义待后端终稿）。
        </p>

        {/* 业务维值选择（复用 DP1 选择器逻辑：泛化 options 端点，存 id 展示名称） */}
        <RecordPicker<DimOption>
          open={pickerFor !== null}
          onOpenChange={(o) => !o && setPickerFor(null)}
          title={`选择「${pickerRow ? dimLabel(pickerRow.dimension) : ""}」可见范围`}
          description="多选：该功能内仅所选范围数据可见（存 id、展示名称）"
          multiple
          data={pickerRow ? (optionsMap[pickerRow.dimension] ?? []) : []}
          columns={optionColumns}
          idField="id"
          labelField="label"
          value={pickerRow ? pickerRow.values.map(String) : []}
          onConfirm={(_ids, rowsPicked) => {
            if (!pickerRow) return
            patchRow(pickerRow.uid, { values: rowsPicked.map((r) => r.id) })
            setNameMap((m) => {
              const next = { ...m }
              rowsPicked.forEach((r) => (next[`${pickerRow.dimension}:${r.id}`] = r.label))
              return next
            })
          }}
          searchKeys={["label"]}
        />

        {/* 部门维值选择（OrgPicker 部门树多选） */}
        <OrgPicker
          open={deptPickerFor !== null}
          onOpenChange={(o) => !o && setDeptPickerFor(null)}
          title="选择该功能可见部门"
          types={["DEPT"]}
          value={(deptRow?.values ?? []).map((v) => ({ type: "DEPT" as const, id: v, name: valueName(DEPT_DIMENSION, v) }))}
          onConfirm={(refs) => {
            if (!deptRow) return
            setDeptPickerFor(null)
            // 「连同子部门」：把每个所选部门展开为其子树显式 id 集（去重；树缺失则原样）
            const expanded = new Map<number, string>(refs.map((r) => [r.id, r.name]))
            if (withChildren && descendantsRef.current) {
              for (const r of refs) {
                for (const d of descendantsRef.current.get(r.id) ?? []) expanded.set(d.id, d.name)
              }
            }
            patchRow(deptRow.uid, { values: [...expanded.keys()] })
            setNameMap((m) => {
              const next = { ...m }
              expanded.forEach((name, did) => (next[`${DEPT_DIMENSION}:${did}`] = name))
              return next
            })
          }}
        />
      </div>
    </ErrorBoundary>
  )
}
