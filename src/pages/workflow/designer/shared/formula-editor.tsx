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
import { Modal } from "@/components/modal"
import { Button } from "@/components/ui/button"
import { AdvancedFormulaEditor } from "@/components/advanced-formula-editor"
import type { FnDoc, ValidateResult } from "@/components/advanced-formula-editor"
import { locateError } from "@/lib/formula-highlight"
import { customFnDocs, useCustomFunctions } from "@/lib/wf-functions"
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

/**
 * 基础语法校验：括号匹配 + 函数名白名单。
 * `extraFns`：额外放行的函数名（后端 CUSTOM 扩展函数），避免把它们误判为「未知函数」。
 */
export function validateFormula(formula: string, extraFns: readonly string[] = []): FormulaValidation {
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

  // 函数名白名单：形如 NAME( 的标识符必须在白名单（含 CUSTOM 扩展）内
  const allowed = new Set([...FORMULA_FN_WHITELIST, ...extraFns])
  const callRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(src))) {
    const name = m[1]
    if (!allowed.has(name)) {
      return { ok: false, message: `未知函数：${name}（不在白名单）` }
    }
  }

  return { ok: true, message: "语法校验通过" }
}

/** 把取人函数目录（FORMULA_CATEGORIES）适配成统一的 FnDoc[]（signature 复用 insert 模板）。 */
const ASSIGNEE_FN_DOCS: FnDoc[] = FORMULA_CATEGORIES.flatMap((cat) =>
  cat.fns.map((fn) => ({
    name: fn.name,
    insertTemplate: fn.insert,
    signature: fn.insert,
    category: cat.title,
    description: fn.desc,
    example: fn.example,
  })),
)

/** 取人公式的字面量 / 关键字（高亮着色用） */
const ASSIGNEE_KEYWORDS = ["true", "false", "null"] as const

/** validateFormula 的「带错误位置」适配版：ok 时通过，否则用 locateError 还原区间。 */
function validateAssigneeFormula(expr: string, extraFns: readonly string[]): ValidateResult {
  const r = validateFormula(expr, extraFns)
  if (r.ok) return { ok: true, message: r.message }
  return { ok: false, message: r.message, ...locateError(expr, r.message) }
}

/** 内置取人函数名集合（用于与后端 CUSTOM 去重，内置优先）。 */
const ASSIGNEE_BUILTIN_NAMES = new Set(ASSIGNEE_FN_DOCS.map((f) => f.name))

export function FormulaEditor({
  value,
  onChange,
  fields,
}: {
  value: string
  onChange: (formula: string) => void
  fields: FormFieldOption[]
}) {
  // 后端 CUSTOM 扩展函数（workDays/deptLeader/dictLabel + 业务新增，会话内缓存 + 降级为空）
  const custom = useCustomFunctions()

  // 「扩展函数」分类：按 name 与内置去重（内置优先），排在取人 / 逻辑 / 比较之后
  const extDocs = useMemo(
    () => customFnDocs(custom.filter((f) => !ASSIGNEE_BUILTIN_NAMES.has(f.name)), "扩展函数"),
    [custom],
  )
  const functions = useMemo(() => [...ASSIGNEE_FN_DOCS, ...extDocs], [extDocs])
  const extNames = useMemo(() => extDocs.map((f) => f.name), [extDocs])
  const validate = useMemo(() => (expr: string) => validateAssigneeFormula(expr, extNames), [extNames])

  return (
    <AdvancedFormulaEditor
      value={value}
      onChange={onChange}
      functions={functions}
      fields={fields}
      validate={validate}
      keywords={ASSIGNEE_KEYWORDS}
      placeholder="点击左侧函数 / 下方字段插入，或直接输入。例：IF(days>3, ROLE('总经理'), DEPT_LEADER(1))"
    />
  )
}

/** 面板内公式字段：紧凑预览 + 「编辑公式」按钮 → 弹窗全功能编辑 */
export function FormulaField({
  value,
  onChange,
  fields,
}: {
  value: string
  onChange: (formula: string) => void
  fields: FormFieldOption[]
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  return (
    <div className="space-y-1.5">
      <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs font-mono break-all min-h-8">
        {value || <span className="text-muted-foreground">未配置公式</span>}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => {
          setDraft(value)
          setOpen(true)
        }}
      >
        编辑公式
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="编辑办理人公式"
        width={760}
        height={560}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                onChange(draft)
                setOpen(false)
              }}
            >
              确定
            </Button>
          </>
        }
      >
        <div className="h-full p-3">
          <FormulaEditor value={draft} onChange={setDraft} fields={fields} />
        </div>
      </Modal>
    </div>
  )
}
