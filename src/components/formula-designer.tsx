/**
 * 公式设计器（Tier 1 安全公式）：函数选择器 + 字段选择器 + 表达式输入 + 实时校验。
 *
 * 产出一个规范表达式串（如 `SUM(items.amount) > 1000 && days > 3`），由
 * `src/lib/formula-eval.ts` 的安全 AST 解释器做**即时语法校验**（`validate`）与可选**实时预览**
 * （`evaluate`，传入 sampleContext 时）。**绝不 new Function/eval**；提交以后端 Aviator 为准。
 *
 * 复用场景：
 *   a) 表单计算字段配置（后续切片接入）；
 *   b) 流程边高级 `expression` 条件（本切片已在 flow-designer 接入）。
 */
import { useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, FunctionSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  FUNCTION_CATALOG,
  evaluate,
  validate,
  type FormulaContext,
  type FunctionDoc,
} from "@/lib/formula-eval"

/** 可引用字段（结构与设计器 `FormFieldOption` 兼容：至少含 key/label） */
export interface FormulaField {
  key: string
  label: string
}

export interface FormulaDesignerProps {
  value: string
  onChange: (expr: string) => void
  /** 可插入引用的表单字段 */
  fields?: FormulaField[]
  /** 传入样例数据则显示实时预览求值结果（可选） */
  sampleContext?: FormulaContext
  placeholder?: string
  className?: string
}

export function FormulaDesigner({
  value,
  onChange,
  fields = [],
  sampleContext,
  placeholder = "点击函数 / 字段插入，或直接输入。例：SUM(items.amount) > 1000 && days > 3",
  className,
}: FormulaDesignerProps) {
  const [selectedFn, setSelectedFn] = useState<FunctionDoc>(FUNCTION_CATALOG[0].fns[0])

  const trimmed = value.trim()
  const result = useMemo(() => validate(value), [value])

  // 实时预览：仅当校验通过且提供了样例上下文
  const preview = useMemo(() => {
    if (!sampleContext || !result.ok) return null
    try {
      return { ok: true as const, value: evaluate(value, sampleContext) }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) }
    }
  }, [value, sampleContext, result.ok])

  const append = (text: string) => onChange(value + text)

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="grid grid-cols-[140px_1fr] gap-2">
        {/* 左：函数库分类 */}
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
          {FUNCTION_CATALOG.map((cat) => (
            <div key={cat.title} className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">{cat.title}</div>
              <div className="flex flex-wrap gap-1">
                {cat.fns.map((fn) => (
                  <button
                    key={fn.name}
                    type="button"
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:border-primary hover:text-primary",
                      selectedFn.name === fn.name && "border-primary/50 bg-primary/5 text-primary",
                    )}
                    onClick={() => {
                      setSelectedFn(fn)
                      append(fn.insert)
                    }}
                  >
                    {fn.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 右：表达式输入 + 字段引用 */}
        <div className="space-y-2">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={5}
            className="font-mono text-xs"
          />
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">插入表单字段</Label>
            {fields.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">未绑定表单，无可引用字段</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {fields.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className="rounded border px-1.5 py-0.5 text-[11px] transition-colors hover:border-primary hover:text-primary"
                    onClick={() => append(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 校验状态（空表达式显示中性提示，不报错） */}
      {trimmed === "" ? (
        <div className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
          <FunctionSquare className="size-3.5" /> 未配置公式
        </div>
      ) : (
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px]",
            result.ok
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
              : "border-amber-500/30 bg-amber-500/5 text-amber-600",
          )}
        >
          {result.ok ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
          {result.ok ? "语法校验通过" : result.error}
        </div>
      )}

      {/* 实时预览（提供 sampleContext 时） */}
      {preview && (
        <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11px]">
          {preview.ok ? (
            <span>
              预览结果：<span className="font-mono text-foreground">{formatPreview(preview.value)}</span>
            </span>
          ) : (
            <span className="text-amber-600">预览求值失败：{preview.message}</span>
          )}
        </div>
      )}

      {/* 选中函数说明 */}
      <div className="space-y-0.5 rounded-md border bg-muted/40 px-2 py-1.5 text-[11px]">
        <div className="flex items-center gap-1 font-mono font-medium">
          <FunctionSquare className="size-3.5 text-primary" />
          {selectedFn.signature}
        </div>
        <div className="text-muted-foreground">{selectedFn.desc}</div>
        <div className="text-muted-foreground">
          示例：<span className="font-mono">{selectedFn.example}</span>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-[11px]"
          onClick={() => onChange("")}
        >
          清空
        </Button>
      </div>
    </div>
  )
}

function formatPreview(v: unknown): string {
  if (v === null || v === undefined) return "（空）"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}
