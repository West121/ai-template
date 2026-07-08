/**
 * 办理人「自定义公式」低代码编辑器（参考简道云 / 宜搭计算公式）。
 *
 * 布局：左侧函数库分类面板（取人 / 逻辑 / 比较）+ 右侧表达式输入（textarea）+ 字段引用插入
 *       + 底部函数说明·示例 + 基础语法校验（括号匹配 / 函数名白名单）。
 *
 * 产出：办理人规则 kind=FORMULA 的 formula 字符串，序列化
 *   { kind:"FORMULA", formula:"IF(days>3, ROLE('总经理'), DEPT_LEADER(1))" }
 * 后端公式求值引擎按同一白名单解析求值出办理人集合（见 docs 校准节 A）。
 */
import { useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, FunctionSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { FormFieldOption } from "./config"

/** 函数定义：名称 / 插入模板（含光标占位）/ 说明 / 示例 */
interface FnDef {
  name: string
  /** 点击插入的文本 */
  insert: string
  desc: string
  example: string
}

interface FnCategory {
  title: string
  fns: FnDef[]
}

/** 函数库（白名单）——分类展示 */
export const FORMULA_CATEGORIES: FnCategory[] = [
  {
    title: "取人函数",
    fns: [
      { name: "USER", insert: "USER(id)", desc: "按用户 id 取指定成员", example: "USER(1001)" },
      { name: "ROLE", insert: "ROLE('角色名')", desc: "按角色名取该角色全部成员", example: "ROLE('总经理')" },
      { name: "DEPT", insert: "DEPT(id)", desc: "按部门 id 取该部门成员", example: "DEPT(20)" },
      { name: "POST", insert: "POST('岗位名')", desc: "按岗位名取该岗位任职成员", example: "POST('财务主管')" },
      { name: "DEPT_LEADER", insert: "DEPT_LEADER(1)", desc: "取发起人第 N 级部门主管", example: "DEPT_LEADER(1)" },
      { name: "INITIATOR", insert: "INITIATOR()", desc: "取流程发起人本人", example: "INITIATOR()" },
    ],
  },
  {
    title: "逻辑函数",
    fns: [
      { name: "IF", insert: "IF(cond, a, b)", desc: "条件成立取 a，否则取 b", example: "IF(days>3, ROLE('总经理'), DEPT_LEADER(1))" },
      { name: "AND", insert: "AND(a, b)", desc: "逻辑与（全部成立）", example: "AND(days>3, amount>1000)" },
      { name: "OR", insert: "OR(a, b)", desc: "逻辑或（任一成立）", example: "OR(urgent==true, days>5)" },
      { name: "NOT", insert: "NOT(x)", desc: "逻辑非", example: "NOT(urgent==true)" },
    ],
  },
  {
    title: "比较运算",
    fns: [
      { name: ">", insert: " > ", desc: "大于", example: "days > 3" },
      { name: ">=", insert: " >= ", desc: "大于等于", example: "amount >= 1000" },
      { name: "<", insert: " < ", desc: "小于", example: "days < 1" },
      { name: "<=", insert: " <= ", desc: "小于等于", example: "level <= 2" },
      { name: "==", insert: " == ", desc: "等于", example: "type == '事假'" },
      { name: "!=", insert: " != ", desc: "不等于", example: "type != '年假'" },
    ],
  },
]

/** 函数名白名单（校验用） */
export const FORMULA_FN_WHITELIST = ["USER", "ROLE", "DEPT", "POST", "DEPT_LEADER", "INITIATOR", "IF", "AND", "OR", "NOT"]

export interface FormulaValidation {
  ok: boolean
  message: string
}

/** 基础语法校验：括号匹配 + 函数名白名单 */
export function validateFormula(formula: string): FormulaValidation {
  const src = formula.trim()
  if (!src) return { ok: false, message: "公式为空" }

  // 括号匹配
  let depth = 0
  for (const ch of src) {
    if (ch === "(") depth++
    else if (ch === ")") {
      depth--
      if (depth < 0) return { ok: false, message: "括号不匹配：多余的 )" }
    }
  }
  if (depth !== 0) return { ok: false, message: "括号不匹配：缺少 )" }

  // 函数名白名单：形如 NAME( 的标识符必须在白名单内
  const callRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(src))) {
    const name = m[1]
    if (!FORMULA_FN_WHITELIST.includes(name)) {
      return { ok: false, message: `未知函数：${name}（不在白名单）` }
    }
  }

  return { ok: true, message: "语法校验通过" }
}

export function FormulaEditor({
  value,
  onChange,
  fields,
}: {
  value: string
  onChange: (formula: string) => void
  fields: FormFieldOption[]
}) {
  const [selectedFn, setSelectedFn] = useState<FnDef | null>(FORMULA_CATEGORIES[0].fns[0])
  const validation = useMemo(() => validateFormula(value), [value])

  const append = (text: string) => onChange(value + text)

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[130px_1fr] gap-2">
        {/* 左侧：函数库分类面板 */}
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
          {FORMULA_CATEGORIES.map((cat) => (
            <div key={cat.title} className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">{cat.title}</div>
              <div className="flex flex-wrap gap-1">
                {cat.fns.map((fn) => (
                  <button
                    key={fn.name}
                    type="button"
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:border-primary hover:text-primary",
                      selectedFn?.name === fn.name && "border-primary/50 bg-primary/5 text-primary",
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

        {/* 右侧：表达式输入 + 字段引用 */}
        <div className="space-y-2">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="点击左侧函数 / 下方字段插入，或直接输入。例：IF(days>3, ROLE('总经理'), DEPT_LEADER(1))"
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

      {/* 校验状态 */}
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px]",
          validation.ok
            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
            : "border-amber-500/30 bg-amber-500/5 text-amber-600",
        )}
      >
        {validation.ok ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
        {validation.message}
      </div>

      {/* 底部：函数说明 / 示例 */}
      {selectedFn && (
        <div className="space-y-0.5 rounded-md border bg-muted/40 px-2 py-1.5 text-[11px]">
          <div className="flex items-center gap-1 font-mono font-medium">
            <FunctionSquare className="size-3.5 text-primary" />
            {selectedFn.insert}
          </div>
          <div className="text-muted-foreground">{selectedFn.desc}</div>
          <div className="text-muted-foreground">
            示例：<span className="font-mono">{selectedFn.example}</span>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => onChange("")}>
          清空
        </Button>
      </div>
    </div>
  )
}
