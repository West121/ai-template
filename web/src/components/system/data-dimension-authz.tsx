/**
 * 多维数据权限授权（DP1）：共享组件，嵌入角色/用户编辑。
 * 每个已注册业务维度一行：维度名 + scope 单选（全部/指定）+ 指定时多选可见范围（options 走泛化端点）。
 * 保存走对应 PUT（全量替换，只下发 CUSTOM 维度；ALL=不限=不下发=等同未配）。与「部门数据权限 5 档」并行。
 * mock 先行 + 三处响应归一 + 空态；调用方再包 ErrorBoundary（防白屏）。
 */
import { useCallback, useEffect, useState } from "react"
// P2：本组件只管**全局层**（feature 空）；功能覆盖层由 DataDimensionOverrides 管理。
// V54 终稿=按层替换：PUT 缺省(?feature 无)即全局层，只动本层——无需保全其它层。
import { toast } from "sonner"
import { CloudOff, Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { RecordPicker, RecordPickerField, type RecordPickerColumn } from "@/components/record-picker"
import { fetchAuthz, fetchDimensionOptions, fetchDimensions, isGlobalRow, saveAuthz, type DataDimension, type DimAuthz, type DimOption, type DimScope, type DpPrincipal } from "./dp-authz-api"

interface RowState {
  scope: DimScope
  values: number[]
}

const optionColumns: RecordPickerColumn<DimOption>[] = [{ key: "label", title: "名称" }]

export function DataDimensionAuthz({ principalType, id, canEdit }: { principalType: DpPrincipal; id: number; canEdit: boolean }) {
  const [dims, setDims] = useState<DataDimension[]>([])
  const [state, setState] = useState<Record<string, RowState>>({})
  const [optionsMap, setOptionsMap] = useState<Record<string, DimOption[]>>({})
  const [nameMap, setNameMap] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [demo, setDemo] = useState(false)
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  const ensureOptions = useCallback((code: string) => {
    setOptionsMap((cur) => {
      if (cur[code]) return cur
      void fetchDimensionOptions(code)
        .then((r) => {
          const opts = Array.isArray(r.data) ? r.data : []
          setOptionsMap((m) => ({ ...m, [code]: opts }))
          setNameMap((m) => {
            const next = { ...m }
            opts.forEach((o) => (next[o.id] = o.label))
            return next
          })
        })
        .catch(() => undefined)
      return cur
    })
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([fetchDimensions(), fetchAuthz(principalType, id)])
      .then(([dimsRes, authzRes]) => {
        const ds = Array.isArray(dimsRes.data) ? dimsRes.data : []
        // 只回显全局层；覆盖层行（feature 非空）由「按功能覆盖」列表管理
        const authz = (Array.isArray(authzRes.data) ? authzRes.data : []).filter(isGlobalRow)
        const st: Record<string, RowState> = {}
        for (const d of ds) {
          const a = authz.find((x) => x.dimension === d.code)
          st[d.code] = a && a.scope === "CUSTOM" ? { scope: "CUSTOM", values: Array.isArray(a.values) ? a.values : [] } : { scope: "ALL", values: [] }
        }
        setDims(ds)
        setState(st)
        setDemo(dimsRes.demo || authzRes.demo)
        ds.filter((d) => st[d.code]?.scope === "CUSTOM").forEach((d) => ensureOptions(d.code))
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "数据维度授权加载失败"))
      .finally(() => setLoading(false))
  }, [principalType, id, ensureOptions])
  useEffect(() => {
    load()
  }, [load])

  const setScope = (code: string, scope: DimScope) => {
    setState((s) => ({ ...s, [code]: { scope, values: s[code]?.values ?? [] } }))
    if (scope === "CUSTOM") ensureOptions(code)
  }

  const save = async () => {
    const bad = dims.find((d) => state[d.code]?.scope === "CUSTOM" && (state[d.code]?.values.length ?? 0) === 0)
    if (bad) {
      toast.error(`「${bad.label}」选择了指定范围，请至少选一个可见值`)
      return
    }
    setSaving(true)
    try {
      // 全局层按层替换：仅下发 CUSTOM 维度（ALL=不限=不下发，等同未配）；PUT 缺省=全局层只动本层
      const list: DimAuthz[] = dims.filter((d) => state[d.code]?.scope === "CUSTOM").map((d) => ({ dimension: d.code, scope: "CUSTOM", values: state[d.code].values }))
      await saveAuthz(principalType, id, list)
      toast.success("数据维度授权已保存")
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
  if (dims.length === 0) {
    return <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">暂无已注册的可配业务维度</div>
  }

  const pickerDim = dims.find((d) => d.code === pickerFor)

  return (
    <div className="space-y-2.5">
      {demo && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <CloudOff className="size-3.5 shrink-0" />
          后端未接入，业务维度为<strong>演示数据</strong>（接入 /api/system/data-dimensions 后自动切换）。
        </div>
      )}
      {dims.map((d) => {
        const row = state[d.code] ?? { scope: "ALL" as DimScope, values: [] }
        return (
          <div key={d.code} className="rounded-md border p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{d.label}</span>
              <RadioGroup value={row.scope} onValueChange={(v) => setScope(d.code, v as DimScope)} disabled={!canEdit} className="flex gap-4">
                <Label className="flex items-center gap-1.5 text-xs font-normal">
                  <RadioGroupItem value="ALL" /> 全部
                </Label>
                <Label className="flex items-center gap-1.5 text-xs font-normal">
                  <RadioGroupItem value="CUSTOM" /> 指定
                </Label>
              </RadioGroup>
            </div>
            {row.scope === "CUSTOM" && (
              <div className="mt-2">
                <RecordPickerField
                  labels={row.values.map((v) => ({ id: String(v), label: nameMap[v] ?? `#${v}` }))}
                  placeholder="选择可见范围（多选）"
                  multiple
                  onOpen={() => {
                    ensureOptions(d.code)
                    setPickerFor(d.code)
                  }}
                  onRemove={(vid) => setState((s) => ({ ...s, [d.code]: { ...s[d.code], values: s[d.code].values.filter((x) => String(x) !== vid) } }))}
                />
              </div>
            )}
          </div>
        )
      })}

      <p className="text-[11px] text-muted-foreground">未配置的维度=不限该维；「全部」=该维不限；「指定」=仅所选范围内可见。与「部门数据权限（5 档）」并行生效。</p>

      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" className="gap-1.5" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 保存数据维度授权
          </Button>
        </div>
      )}

      <RecordPicker<DimOption>
        open={pickerFor !== null}
        onOpenChange={(o) => !o && setPickerFor(null)}
        title={`选择「${pickerDim?.label ?? ""}」可见范围`}
        description="多选：仅所选范围内数据可见（存 id、展示名称）"
        multiple
        data={pickerFor ? (optionsMap[pickerFor] ?? []) : []}
        columns={optionColumns}
        idField="id"
        labelField="label"
        value={pickerFor ? (state[pickerFor]?.values ?? []).map(String) : []}
        onConfirm={(_ids, rows) => {
          if (!pickerFor) return
          const code = pickerFor
          setState((s) => ({ ...s, [code]: { ...s[code], values: rows.map((r) => r.id) } }))
          setNameMap((m) => {
            const next = { ...m }
            rows.forEach((r) => (next[r.id] = r.label))
            return next
          })
        }}
        searchKeys={["label"]}
      />
    </div>
  )
}
