/**
 * 公式设计器（Tier 1 安全公式）：内部复用 `AdvancedFormulaEditor`（语法高亮 / 自动补全 /
 * 参数提示 / 实时校验 + 定位 / 实时预览 / 可搜索函数文档），对外 props 与产出串**保持不变**。
 *
 * 产出一个规范表达式串（如 `SUM(items.amount) > 1000 && days > 3`），由
 * `src/lib/formula-eval.ts` 的安全 AST 解释器做**即时语法校验**（`validate`）与可选**实时预览**
 * （`evaluate`，传入 sampleContext 时）。**绝不 new Function/eval**；提交以后端 Aviator 为准。
 *
 * 复用场景：
 *   a) 表单计算字段配置（后续切片接入）；
 *   b) 流程边高级 `expression` 条件（本切片已在 flow-designer 接入）。
 */
import { useMemo } from "react"
import { AdvancedFormulaEditor } from "@/components/advanced-formula-editor"
import type { EvaluateResult, FnDoc, ValidateResult } from "@/components/advanced-formula-editor"
import { locateError } from "@/lib/formula-highlight"
import { FUNCTION_CATALOG, evaluate, validate, type FormulaContext } from "@/lib/formula-eval"

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

/** 把计算函数目录（FUNCTION_CATALOG）适配成统一的 FnDoc[]。 */
const CALC_FN_DOCS: FnDoc[] = FUNCTION_CATALOG.flatMap((cat) =>
  cat.fns.map((fn) => ({
    name: fn.name,
    insertTemplate: fn.insert,
    signature: fn.signature,
    category: cat.title,
    description: fn.desc,
    example: fn.example,
  })),
)

/** 计算公式字面量 / 关键字（高亮着色用） */
const CALC_KEYWORDS = ["true", "false", "null"] as const

/** formula-eval.validate 的「带错误位置」适配版。 */
function validateCalcFormula(expr: string): ValidateResult {
  const r = validate(expr)
  if (r.ok) return { ok: true }
  const message = r.error ?? "语法有误"
  return { ok: false, message, ...locateError(expr, message) }
}

export function FormulaDesigner({
  value,
  onChange,
  fields = [],
  sampleContext,
  placeholder = "点击函数 / 字段插入，或直接输入。例：SUM(items.amount) > 1000 && days > 3",
  className,
}: FormulaDesignerProps) {
  // 仅在提供样例上下文时挂 evaluate（→ 实时预览求值结果）；否则退化为「解析结构」摘要。
  const evaluateAdapter = useMemo(() => {
    if (!sampleContext) return undefined
    return (expr: string): EvaluateResult => {
      try {
        return { ok: true, value: evaluate(expr, sampleContext) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  }, [sampleContext])

  return (
    <AdvancedFormulaEditor
      className={className}
      value={value}
      onChange={onChange}
      functions={CALC_FN_DOCS}
      fields={fields}
      validate={validateCalcFormula}
      evaluate={evaluateAdapter}
      sampleContext={sampleContext}
      keywords={CALC_KEYWORDS}
      placeholder={placeholder}
    />
  )
}
