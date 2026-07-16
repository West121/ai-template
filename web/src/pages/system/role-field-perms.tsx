/**
 * 角色抽屉「字段权限」Tab（权限中心 P3）：功能选择 → 字段矩阵（复用 field-perms-editor 的
 * 矩阵/分组形态，两列勾选 visible/editable；visible=false → editable 自动关且禁用）→
 * 保存 PUT（按 feature 全量替换，只下发受限字段）。catalog 空的功能如实显示「暂不支持字段权限」。
 * formFields 按 group 分组 + fixedColumns 独立「列表固定列」组；全选/反选工具条。
 * dirty 经 onDirtyChange 汇报给抽屉未保存拦截；resetSignal 由抽屉「丢弃」触发回滚。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { CloudOff, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { groupFields, type VisibleEditable } from "@/components/field-perms-editor"
import type { FieldDescriptor } from "@/lib/form-manifest"
import {
  fetchAiFeatures,
  fetchFieldPermCatalog,
  fetchRoleFieldPerms,
  invalidateMineFieldPerms,
  saveRoleFieldPerms,
  type AiFeatureItem,
  type FieldPermCatalog,
  type RoleFieldPermEntry,
  type RoleFieldPermInput,
} from "@/lib/field-perms"

type VeMap = Record<string, VisibleEditable>

const ALL_ALLOW: VisibleEditable = { visible: true, editable: true }

function buildVeMap(catalog: FieldPermCatalog, entries: RoleFieldPermEntry[]): VeMap {
  const map: VeMap = {}
  for (const f of catalog.formFields) map[f.key] = { ...ALL_ALLOW }
  for (const c of catalog.fixedColumns) map[c.field] ??= { ...ALL_ALLOW }
  for (const e of entries) {
    if (map[e.field] !== undefined) map[e.field] = { visible: e.visible !== false, editable: e.editable !== false && e.visible !== false }
  }
  return map
}

function sameVe(a: VeMap, b: VeMap): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => b[k] && a[k].visible === b[k].visible && a[k].editable === b[k].editable)
}

export function RoleFieldPermsTab({
  roleId,
  canEdit,
  onDirtyChange,
  resetSignal = 0,
}: {
  roleId: number
  canEdit: boolean
  onDirtyChange?: (dirty: boolean) => void
  /** 抽屉「丢弃」时自增 → 回滚到快照 */
  resetSignal?: number
}) {
  const [features, setFeatures] = useState<AiFeatureItem[]>([])
  const [feature, setFeature] = useState<string>("")
  const [catalog, setCatalog] = useState<FieldPermCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [demo, setDemo] = useState(false)
  const [ve, setVe] = useState<VeMap>({})
  const [snapshot, setSnapshot] = useState<VeMap>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchAiFeatures()
      .then((r) => setFeatures(r.data))
      .catch(() => setFeatures([]))
  }, [])

  const loadFeature = useCallback(
    (f: string) => {
      setLoading(true)
      setCatalog(null)
      void Promise.all([fetchFieldPermCatalog(f), fetchRoleFieldPerms(roleId, f)])
        .then(([cat, perms]) => {
          setCatalog(cat.data)
          setDemo(cat.demo || perms.demo)
          const map = buildVeMap(cat.data, perms.data)
          setVe(map)
          setSnapshot(map)
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "字段目录加载失败"))
        .finally(() => setLoading(false))
    },
    [roleId],
  )

  useEffect(() => {
    if (feature) loadFeature(feature)
  }, [feature, loadFeature])

  // 丢弃回滚
  useEffect(() => {
    if (resetSignal > 0) setVe(snapshot)
    // 仅响应 resetSignal 变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  const dirty = useMemo(() => !sameVe(ve, snapshot), [ve, snapshot])
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const setField = (key: string, next: VisibleEditable) =>
    setVe((m) => ({ ...m, [key]: { visible: next.visible, editable: next.visible ? next.editable : false } }))

  const setAll = (patch: Partial<VisibleEditable>) =>
    setVe((m) => {
      const out: VeMap = {}
      for (const [k, v] of Object.entries(m)) {
        const visible = patch.visible ?? v.visible
        const editable = patch.editable ?? v.editable
        out[k] = { visible, editable: visible ? editable : false }
      }
      return out
    })

  const save = async () => {
    if (!feature || !catalog) return
    // 只下发受限字段（全放行=不下发，全量替换语义）；body 条目不带 feature（走查询参数）
    const entries: RoleFieldPermInput[] = Object.entries(ve)
      .filter(([, v]) => !v.visible || !v.editable)
      .map(([field, v]) => ({ field, visible: v.visible, editable: v.editable }))
    setSaving(true)
    try {
      const r = await saveRoleFieldPerms(roleId, feature, entries)
      setSnapshot(ve)
      invalidateMineFieldPerms(feature)
      toast.success(`已保存「${features.find((f) => f.featureCode === feature)?.name ?? feature}」字段权限（受限 ${entries.length} 项）${r.demo ? "（演示）" : ""}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  // 矩阵分组：formFields 按 group + fixedColumns 独立组
  const groups = useMemo(() => {
    if (!catalog) return []
    const formGroups = groupFields(catalog.formFields as FieldDescriptor[])
    const fixed = catalog.fixedColumns.map((c) => ({ key: c.field, label: c.label }) as FieldDescriptor)
    return fixed.length > 0 ? [...formGroups, { name: "列表固定列", fields: fixed }] : formGroups
  }, [catalog])

  const empty = catalog != null && catalog.formFields.length === 0 && catalog.fixedColumns.length === 0

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>功能</Label>
        <Select value={feature || undefined} onValueChange={setFeature}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择一个功能以配置其字段权限" />
          </SelectTrigger>
          <SelectContent>
            {features.map((f) => (
              <SelectItem key={f.featureCode} value={f.featureCode}>
                {f.name}
                <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{f.featureCode}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {demo && feature && (
        <p className="flex items-center gap-1.5 rounded-md border border-dashed bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <CloudOff className="size-3.5 shrink-0" /> 后端不可达——当前为演示数据，可完整走通配置。
        </p>
      )}

      {!feature ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-8 text-center">
          <ShieldCheck className="size-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">选择一个功能以配置其字段权限（可见 / 可编辑，与流程节点级叠加取更严）</p>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : empty ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">该功能暂不支持字段权限（无表单字段/固定列目录）。</p>
      ) : catalog ? (
        <>
          {/* 全选/反选工具条 */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { label: "全部可见", patch: { visible: true } },
                { label: "全部隐藏", patch: { visible: false } },
                { label: "全部可编辑", patch: { visible: true, editable: true } },
                { label: "全部只读", patch: { editable: false } },
              ] as { label: string; patch: Partial<VisibleEditable> }[]
            ).map((b) => (
              <Button key={b.label} variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={!canEdit} onClick={() => setAll(b.patch)}>
                {b.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-1 text-[11px] font-medium text-muted-foreground">
            <span>字段</span>
            <span className="w-10 text-center">可见</span>
            <span className="w-12 text-center">可编辑</span>
          </div>
          {groups.map((group) => (
            <div key={group.name} className="space-y-1">
              <div className="px-1 text-[11px] font-medium text-foreground/70">{group.name}</div>
              {group.fields.map((f) => {
                const v = ve[f.key] ?? ALL_ALLOW
                return (
                  <div key={f.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 rounded-md px-1 py-1 hover:bg-accent/40">
                    <span className="truncate text-xs" title={f.key}>
                      {f.label}
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{f.key}</span>
                    </span>
                    <span className="flex w-10 justify-center">
                      <Checkbox
                        checked={v.visible}
                        disabled={!canEdit}
                        onCheckedChange={(c) => setField(f.key, { visible: c === true, editable: v.editable })}
                        aria-label={`${f.label} 可见`}
                      />
                    </span>
                    <span className="flex w-12 justify-center">
                      <Checkbox
                        checked={v.editable}
                        disabled={!canEdit || !v.visible}
                        onCheckedChange={(c) => setField(f.key, { visible: v.visible, editable: c === true })}
                        aria-label={`${f.label} 可编辑`}
                      />
                    </span>
                  </div>
                )
              })}
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 border-t pt-2">
            <p className="text-[11px] text-muted-foreground">前端隐藏/只读是体验；后端响应脱敏为权威（与节点级叠加取更严）。</p>
            <Button size="sm" className="h-7 shrink-0 text-xs" disabled={!canEdit || saving || !dirty} onClick={() => void save()}>
              {saving ? "保存中…" : "保存字段权限"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
