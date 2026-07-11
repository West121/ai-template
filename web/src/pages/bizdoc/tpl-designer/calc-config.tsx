/**
 * 计算配置页（bizdoc-design.md §12，两步向导第 ① 步，照用户第四张截图）：
 * 聚合字段卡片（字段名/标签/数据源子表下拉/聚合字段/聚合函数/格式化/小数位 stepper）+
 * 计算字段卡片（字段名/标签/格式化/小数位/计算公式 + 函数提示行）+ 底部蓝色使用说明。
 * 产出命名变量，模板设计步 {{变量名}} 引用；求值在后端出数据时进行（前端仅预览演示）。
 */
import { Minus, Plus, Sigma, SquareFunction, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  newAggregate,
  newComputed,
  type BdCalc,
  type BdCalcAggregate,
  type BdCalcComputed,
  type CalcFn,
  type CalcFormat,
} from "@/components/bizdoc/model-v2"
import { CommitInput } from "./props-panel"

const FN_LABEL: Record<CalcFn, string> = { SUM: "求和", AVG: "平均", MAX: "最大", MIN: "最小", COUNT: "计数" }

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

/** 小数位 stepper（截图样式：[-] n [+]，0~4） */
function ScaleStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex h-7 w-fit items-center rounded-md border">
      <button type="button" aria-label="减少小数位" disabled={value <= 0} className="px-2 text-muted-foreground disabled:opacity-30" onClick={() => onChange(Math.max(0, value - 1))}>
        <Minus className="size-3" />
      </button>
      <span className="w-6 text-center text-xs tabular-nums">{value}</span>
      <button type="button" aria-label="增加小数位" disabled={value >= 4} className="px-2 text-muted-foreground disabled:opacity-30" onClick={() => onChange(Math.min(4, value + 1))}>
        <Plus className="size-3" />
      </button>
    </div>
  )
}

function FormatSelect({ value, onChange }: { value: CalcFormat; onChange: (v: CalcFormat) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as CalcFormat)}>
      <SelectTrigger size="sm" className="h-7 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="number">数字</SelectItem>
        <SelectItem value="chinese">中文大写</SelectItem>
      </SelectContent>
    </Select>
  )
}

export interface CalcConfigProps {
  calc: BdCalc
  /** 数据源候选（子表字段：schema subform ∪ 模板 detailTable 引用） */
  subformOptions: { key: string; label: string }[]
  /** 各子表已知列（聚合字段快捷 chips；来自模板 detailTable columns） */
  columnsBySource: Record<string, { field: string; label: string }[]>
  onChange: (calc: BdCalc) => void
}

export function CalcConfig({ calc, subformOptions, columnsBySource, onChange }: CalcConfigProps) {
  const patchAgg = (i: number, p: Partial<BdCalcAggregate>) =>
    onChange({ ...calc, aggregates: calc.aggregates.map((a, x) => (x === i ? { ...a, ...p } : a)) })
  const patchComputed = (i: number, p: Partial<BdCalcComputed>) =>
    onChange({ ...calc, computed: calc.computed.map((c, x) => (x === i ? { ...c, ...p } : c)) })

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
      {/* 聚合字段 */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sigma className="size-4 text-primary" /> 聚合字段
          </h3>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => onChange({ ...calc, aggregates: [...calc.aggregates, newAggregate()] })}>
            <Plus className="size-3.5" /> 新增聚合字段
          </Button>
        </div>
        {calc.aggregates.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            暂无聚合字段。对子表数据做求和/平均/最大/最小/计数，结果生成命名变量。
          </p>
        )}
        {calc.aggregates.map((a, i) => (
          <div key={i} className="space-y-2.5 rounded-lg border bg-card p-3">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Field label="字段名（变量名）">
                <CommitInput value={a.name} mono placeholder="如 total_amount" onCommit={(v) => patchAgg(i, { name: v })} />
              </Field>
              <Field label="字段标签">
                <CommitInput value={a.label} placeholder="如 合计金额" onCommit={(v) => patchAgg(i, { label: v })} />
              </Field>
              <Field label="数据源（子表）">
                <Select value={a.source || undefined} onValueChange={(v) => patchAgg(i, { source: v })}>
                  <SelectTrigger size="sm" className="h-7 w-full text-xs">
                    <SelectValue placeholder={subformOptions.length ? "选择子表" : "暂无子表字段"} />
                  </SelectTrigger>
                  <SelectContent>
                    {subformOptions.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}（{s.key}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="聚合函数">
                <Select value={a.fn} onValueChange={(v) => patchAgg(i, { fn: v as CalcFn })}>
                  <SelectTrigger size="sm" className="h-7 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FN_LABEL) as CalcFn[]).map((fn) => (
                      <SelectItem key={fn} value={fn}>
                        {FN_LABEL[fn]}（{fn}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Field label={a.fn === "COUNT" ? "聚合字段（列，可空=数行数）" : "聚合字段（列）"} className="sm:col-span-2">
                <CommitInput value={a.field} mono placeholder="如 amount" onCommit={(v) => patchAgg(i, { field: v })} />
                {(columnsBySource[a.source] ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {(columnsBySource[a.source] ?? []).map((c) => (
                      <button
                        key={c.field}
                        type="button"
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${a.field === c.field ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/40 hover:text-primary"}`}
                        onClick={() => patchAgg(i, { field: c.field })}
                      >
                        {c.label || c.field}
                      </button>
                    ))}
                  </div>
                )}
              </Field>
              <Field label="格式化">
                <FormatSelect value={a.format} onChange={(v) => patchAgg(i, { format: v })} />
              </Field>
              <Field label="小数位数">
                <div className="flex items-center justify-between gap-2">
                  <ScaleStepper value={a.scale} onChange={(v) => patchAgg(i, { scale: v })} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-rose-600"
                    aria-label="删除聚合字段"
                    onClick={() => onChange({ ...calc, aggregates: calc.aggregates.filter((_, x) => x !== i) })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </Field>
            </div>
          </div>
        ))}
      </section>

      {/* 计算字段 */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <SquareFunction className="size-4 text-primary" /> 计算字段
          </h3>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => onChange({ ...calc, computed: [...calc.computed, newComputed()] })}>
            <Plus className="size-3.5" /> 新增计算字段
          </Button>
        </div>
        {calc.computed.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            暂无计算字段。用公式对表单字段与聚合结果再计算，如 quantity * unit_price * (1 - discount_rate)。
          </p>
        )}
        {calc.computed.map((c, i) => (
          <div key={i} className="space-y-2.5 rounded-lg border bg-card p-3">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Field label="字段名（变量名）">
                <CommitInput value={c.name} mono placeholder="如 final_amount" onCommit={(v) => patchComputed(i, { name: v })} />
              </Field>
              <Field label="字段标签">
                <CommitInput value={c.label} placeholder="如 折后金额" onCommit={(v) => patchComputed(i, { label: v })} />
              </Field>
              <Field label="格式化">
                <FormatSelect value={c.format} onChange={(v) => patchComputed(i, { format: v })} />
              </Field>
              <Field label="小数位数">
                <div className="flex items-center justify-between gap-2">
                  <ScaleStepper value={c.scale} onChange={(v) => patchComputed(i, { scale: v })} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-rose-600"
                    aria-label="删除计算字段"
                    onClick={() => onChange({ ...calc, computed: calc.computed.filter((_, x) => x !== i) })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </Field>
            </div>
            <Field label="计算公式">
              <CommitInput value={c.expr} mono placeholder="如 quantity * unit_price * (1 - discount_rate)" onCommit={(v) => patchComputed(i, { expr: v })} />
              <p className="pt-0.5 text-[10px] text-muted-foreground">
                支持函数：<span className="font-mono">round</span>、<span className="font-mono">abs</span>、
                <span className="font-mono">numberToChinese</span>；可引用表单字段与聚合字段变量名。
              </p>
            </Field>
          </div>
        ))}
      </section>

      {/* 使用说明（蓝条，照截图） */}
      <div className="space-y-1.5 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-xs leading-relaxed text-blue-700 dark:text-blue-300">
        <p className="font-semibold">使用说明</p>
        <p>1. 聚合字段：对明细子表的某一列做求和/平均/最大/最小/计数，结果生成命名变量；</p>
        <p>2. 计算字段：公式可引用表单字段与聚合字段变量名，如 quantity * unit_price * (1 - discount_rate)；</p>
        <p>3. 支持函数：round（四舍五入）、abs（绝对值）、numberToChinese（金额转人民币大写），中文大写格式亦可直接在「格式化」里选择；</p>
        <p>4. 计算在出数据时求值（后端），模板设计步用 {"{{字段名}}"} 引用结果；某项求值失败该变量显示 "-"，不影响打印。</p>
      </div>
    </div>
  )
}
