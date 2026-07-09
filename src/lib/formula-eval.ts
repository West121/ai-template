/**
 * Tier 1 公式 · 安全 AST 表达式解释器（**绝不用 `new Function` / `eval` / `with`**）。
 *
 * 用途：表单计算字段、自定义校验、流程边「高级公式条件」（`expression`）在浏览器内的
 *   「实时预览 + 即时语法校验」。语义尽量与后端 Aviator Tier 1 对齐，但**求值权威在服务端**
 *   —— 前端仅作预览/校验，提交后以后端引擎结果为准
 *   （见 docs/design/next-gen-workflow-and-formula.md 第三部分）。
 *
 * 安全模型（F-01 假沙箱的真修复 = 诚实 + 真隔离）：
 *   本解释器**只做「词法 → 解析出 AST → 遍历求值」**，全程不生成/执行任何 JS 代码字符串。
 *   - 标识符只在传入的 `context` 内解析，够不到 window / fetch / globalThis / 作用域链。
 *   - 只能调用 `FUNCTIONS` 白名单里的纯函数，无法拿到 constructor / Function / 原型链。
 *   - 成员访问只读普通对象的自有属性并显式屏蔽 `__proto__` / `constructor` / `prototype`，
 *     数组成员访问退化为「按列摘取」（如 `items.amount`），不触碰原型方法。
 *   与旧 `form-runtime.ts` 里 `new Function("value","data", …)` 的「假沙箱」相对：那种写法
 *   window / fetch / localStorage 全可达，本文件从根上消除该能力。
 */

/* ============================================================
 * AST
 * ============================================================ */

type NumNode = { t: "num"; v: number }
type StrNode = { t: "str"; v: string }
type BoolNode = { t: "bool"; v: boolean }
type NullNode = { t: "null" }
type IdNode = { t: "id"; name: string }
type MemberNode = { t: "member"; obj: AstNode; prop: string }
type CallNode = { t: "call"; name: string; args: AstNode[] }
type UnaryNode = { t: "unary"; op: "!" | "-" | "+"; arg: AstNode }
type BinNode = { t: "bin"; op: BinOp; left: AstNode; right: AstNode }

export type AstNode =
  | NumNode
  | StrNode
  | BoolNode
  | NullNode
  | IdNode
  | MemberNode
  | CallNode
  | UnaryNode
  | BinNode

type BinOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "&&"
  | "||"

/** 求值上下文：字段引用（key → 值）。可含任意可读对象（如 `{ value, data }`）。 */
export type FormulaContext = Record<string, unknown>

/** 白名单函数签名：接收已求值实参，返回结果值。必须为纯函数、无副作用。 */
export type FormulaFn = (args: readonly unknown[]) => unknown

/** 公式解析/求值错误（携带诊断信息，供设计器展示） */
export class FormulaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FormulaError"
  }
}

/** 表达式最大长度（防超长输入 DoS） */
const MAX_LENGTH = 2000

/* ============================================================
 * 词法分析（Tokenizer）
 * ============================================================ */

type Tok =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "id"; v: string }
  | { k: "op"; v: string }

/** 多字符运算符（先匹配长的） */
const MULTI_OPS = ["==", "!=", ">=", "<=", "&&", "||"]
const SINGLE_OPS = new Set(["+", "-", "*", "/", "%", ">", "<", "!", "(", ")", ",", "."])

function tokenize(src: string): Tok[] {
  if (src.length > MAX_LENGTH) throw new FormulaError(`表达式过长（上限 ${MAX_LENGTH} 字符）`)
  const toks: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    // 空白
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++
      continue
    }
    // 字符串（单/双引号，支持 \\ 转义）
    if (c === "'" || c === '"') {
      const quote = c
      let j = i + 1
      let out = ""
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < n) {
          const nx = src[j + 1]
          out += nx === "n" ? "\n" : nx === "t" ? "\t" : nx
          j += 2
        } else {
          out += src[j]
          j++
        }
      }
      if (j >= n) throw new FormulaError("字符串缺少结束引号")
      toks.push({ k: "str", v: out })
      i = j + 1
      continue
    }
    // 数字（含小数）
    if (c >= "0" && c <= "9") {
      let j = i
      while (j < n && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++
      const raw = src.slice(i, j)
      const num = Number(raw)
      if (Number.isNaN(num)) throw new FormulaError(`非法数字：${raw}`)
      toks.push({ k: "num", v: num })
      i = j
      continue
    }
    // 标识符 / 函数名（字母、下划线开头，允许中文，后续可含数字与 $）
    if (isIdentStart(c)) {
      let j = i + 1
      while (j < n && isIdentPart(src[j])) j++
      toks.push({ k: "id", v: src.slice(i, j) })
      i = j
      continue
    }
    // 多字符运算符
    const two = src.slice(i, i + 2)
    if (MULTI_OPS.includes(two)) {
      toks.push({ k: "op", v: two })
      i += 2
      continue
    }
    // 单字符运算符
    if (SINGLE_OPS.has(c)) {
      toks.push({ k: "op", v: c })
      i++
      continue
    }
    throw new FormulaError(`无法识别的字符：「${c}」（位置 ${i}）`)
  }
  return toks
}

function isIdentStart(c: string): boolean {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    c === "_" ||
    c.charCodeAt(0) > 127 // 允许中文等非 ASCII 字段名
  )
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || (c >= "0" && c <= "9") || c === "$"
}

/* ============================================================
 * 语法分析（递归下降 + 运算符优先级）
 * ============================================================ */

/** 二元运算符优先级（数值越大越先结合） */
const BIN_PREC: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  ">": 4,
  ">=": 4,
  "<": 4,
  "<=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
}

class Parser {
  private pos = 0
  private readonly toks: Tok[]
  constructor(toks: Tok[]) {
    this.toks = toks
  }

  parse(): AstNode {
    const node = this.parseExpr(0)
    if (this.pos < this.toks.length) {
      throw new FormulaError(`表达式多余内容：${this.describe(this.toks[this.pos])}`)
    }
    return node
  }

  /** 优先级爬升：解析左结合二元表达式 */
  private parseExpr(minPrec: number): AstNode {
    let left = this.parseUnary()
    for (;;) {
      const t = this.toks[this.pos]
      if (!t || t.k !== "op") break
      const prec = BIN_PREC[t.v]
      if (prec === undefined || prec < minPrec) break
      this.pos++
      const right = this.parseExpr(prec + 1) // 左结合
      left = { t: "bin", op: t.v as BinOp, left, right }
    }
    return left
  }

  private parseUnary(): AstNode {
    const t = this.toks[this.pos]
    if (t && t.k === "op" && (t.v === "!" || t.v === "-" || t.v === "+")) {
      this.pos++
      return { t: "unary", op: t.v, arg: this.parseUnary() }
    }
    return this.parsePostfix()
  }

  /** 后缀：成员访问 `.prop`（函数调用仅允许作用在裸标识符上，见 parsePrimary） */
  private parsePostfix(): AstNode {
    let node = this.parsePrimary()
    for (;;) {
      const t = this.toks[this.pos]
      if (t && t.k === "op" && t.v === ".") {
        this.pos++
        const prop = this.toks[this.pos]
        if (!prop || prop.k !== "id") throw new FormulaError("「.」后应为属性名")
        this.pos++
        node = { t: "member", obj: node, prop: prop.v }
        continue
      }
      break
    }
    return node
  }

  private parsePrimary(): AstNode {
    const t = this.toks[this.pos]
    if (!t) throw new FormulaError("表达式意外结束")

    if (t.k === "num") {
      this.pos++
      return { t: "num", v: t.v }
    }
    if (t.k === "str") {
      this.pos++
      return { t: "str", v: t.v }
    }
    if (t.k === "op" && t.v === "(") {
      this.pos++
      const inner = this.parseExpr(0)
      this.expect(")")
      return inner
    }
    if (t.k === "id") {
      this.pos++
      // 字面量关键字
      if (t.v === "true") return { t: "bool", v: true }
      if (t.v === "false") return { t: "bool", v: false }
      if (t.v === "null") return { t: "null" }
      // 函数调用：标识符紧跟 `(` —— 调用目标只能是裸标识符（杜绝 x.constructor(...) 之类）
      const nx = this.toks[this.pos]
      if (nx && nx.k === "op" && nx.v === "(") {
        this.pos++
        const args: AstNode[] = []
        if (!(this.toks[this.pos]?.k === "op" && this.toks[this.pos]?.v === ")")) {
          for (;;) {
            args.push(this.parseExpr(0))
            const sep = this.toks[this.pos]
            if (sep && sep.k === "op" && sep.v === ",") {
              this.pos++
              continue
            }
            break
          }
        }
        this.expect(")")
        return { t: "call", name: t.v, args }
      }
      return { t: "id", name: t.v }
    }
    throw new FormulaError(`意外的记号：${this.describe(t)}`)
  }

  private expect(op: string): void {
    const t = this.toks[this.pos]
    if (!t || t.k !== "op" || t.v !== op) {
      throw new FormulaError(`缺少「${op}」`)
    }
    this.pos++
  }

  private describe(t: Tok | undefined): string {
    if (!t) return "（结束）"
    if (t.k === "str") return `"${t.v}"`
    return String(t.v)
  }
}

/** 解析表达式为 AST（只解析、不执行）。失败抛 `FormulaError`。 */
export function parseFormula(expr: string): AstNode {
  return new Parser(tokenize(expr)).parse()
}

/* ============================================================
 * 求值（遍历 AST）
 * ============================================================ */

/** 危险成员名黑名单：即使成员访问也绝不放行 */
const BLOCKED_PROPS = new Set(["__proto__", "constructor", "prototype"])

function getMember(obj: unknown, prop: string): unknown {
  if (BLOCKED_PROPS.has(prop)) return undefined
  if (obj == null) return undefined
  // 数组：成员访问退化为「按列摘取」（SUM(items.amount) 语义）
  if (Array.isArray(obj)) {
    return obj.map((el) => getMember(el, prop))
  }
  if (typeof obj === "object") {
    // 仅读自有属性，够不到原型链
    return Object.prototype.hasOwnProperty.call(obj, prop)
      ? (obj as Record<string, unknown>)[prop]
      : undefined
  }
  // 基本类型（string/number/boolean）不暴露原生属性（如 .length）；请改用 LEN() 等函数
  return undefined
}

function evalNode(node: AstNode, ctx: FormulaContext): unknown {
  switch (node.t) {
    case "num":
      return node.v
    case "str":
      return node.v
    case "bool":
      return node.v
    case "null":
      return null
    case "id":
      // 标识符只在 ctx 内解析：缺失字段 → undefined（与「空字段」一致，不抛错）
      return Object.prototype.hasOwnProperty.call(ctx, node.name) ? ctx[node.name] : undefined
    case "member":
      return getMember(evalNode(node.obj, ctx), node.prop)
    case "unary": {
      const v = evalNode(node.arg, ctx)
      if (node.op === "!") return !toBool(v)
      if (node.op === "-") return -toNum(v)
      return +toNum(v)
    }
    case "bin":
      return evalBin(node, ctx)
    case "call": {
      const fn = FUNCTIONS[node.name]
      if (!fn) throw new FormulaError(`未知函数：${node.name}`)
      const args = node.args.map((a) => evalNode(a, ctx))
      return fn(args)
    }
  }
}

function evalBin(node: BinNode, ctx: FormulaContext): unknown {
  // 逻辑运算短路
  if (node.op === "&&") {
    return toBool(evalNode(node.left, ctx)) ? toBool(evalNode(node.right, ctx)) : false
  }
  if (node.op === "||") {
    return toBool(evalNode(node.left, ctx)) ? true : toBool(evalNode(node.right, ctx))
  }
  const l = evalNode(node.left, ctx)
  const r = evalNode(node.right, ctx)
  switch (node.op) {
    // 相等：字符串归一化比较（与 form-runtime evalCondition eq/ne 一致，兼容 "3" == 3）
    case "==":
      return looseEq(l, r)
    case "!=":
      return !looseEq(l, r)
    // 关系：数值比较
    case ">":
      return toNum(l) > toNum(r)
    case ">=":
      return toNum(l) >= toNum(r)
    case "<":
      return toNum(l) < toNum(r)
    case "<=":
      return toNum(l) <= toNum(r)
    // 算术：数值运算（字符串拼接请用 CONCAT）
    case "+":
      return toNum(l) + toNum(r)
    case "-":
      return toNum(l) - toNum(r)
    case "*":
      return toNum(l) * toNum(r)
    case "/":
      return toNum(l) / toNum(r)
    case "%":
      return toNum(l) % toNum(r)
    default:
      throw new FormulaError(`未知运算符：${node.op}`)
  }
}

/* ============================================================
 * 值强制转换（与 form-runtime 语义对齐）
 * ============================================================ */

function toNum(v: unknown): number {
  if (typeof v === "number") return v
  if (typeof v === "boolean") return v ? 1 : 0
  if (v == null || v === "") return NaN
  return Number(v)
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v
  if (v == null) return false
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v)
  if (typeof v === "string") return v !== "" && v !== "false" && v !== "0"
  if (Array.isArray(v)) return v.length > 0
  return true
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true
  return String(a ?? "") === String(b ?? "")
}

/* ============================================================
 * 白名单函数表（可扩展）
 * ============================================================ */

/** 把实参（可能含数组）扁平化为数值列表 */
function flatNums(args: readonly unknown[]): number[] {
  const out: number[] = []
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(push)
    else {
      const n = toNum(v)
      if (!Number.isNaN(n)) out.push(n)
    }
  }
  args.forEach(push)
  return out
}

/**
 * Tier 1 公式白名单函数。**可扩展**：向本表注册纯函数即可（务必无副作用）。
 * 语义与后端 Aviator Tier 1 尽量对齐；前端仅预览，后端为准。
 */
export const FUNCTIONS: Record<string, FormulaFn> = {
  /* 数学 / 聚合 */
  SUM: (args) => flatNums(args).reduce((s, v) => s + v, 0),
  AVG: (args) => {
    const ns = flatNums(args)
    return ns.length === 0 ? 0 : ns.reduce((s, v) => s + v, 0) / ns.length
  },
  MAX: (args) => {
    const ns = flatNums(args)
    return ns.length === 0 ? 0 : Math.max(...ns)
  },
  MIN: (args) => {
    const ns = flatNums(args)
    return ns.length === 0 ? 0 : Math.min(...ns)
  },
  ABS: (args) => Math.abs(toNum(args[0])),
  ROUND: (args) => {
    const digits = args.length > 1 ? Math.trunc(toNum(args[1])) : 0
    const f = 10 ** digits
    return Math.round(toNum(args[0]) * f) / f
  },
  /* 逻辑 */
  IF: (args) => (toBool(args[0]) ? args[1] : args[2]),
  AND: (args) => args.every((a) => toBool(a)),
  OR: (args) => args.some((a) => toBool(a)),
  NOT: (args) => !toBool(args[0]),
  /* 文本 */
  LEN: (args) => {
    const v = args[0]
    if (Array.isArray(v)) return v.length
    return String(v ?? "").length
  },
  CONCAT: (args) => args.map((a) => (a == null ? "" : String(a))).join(""),
  UPPER: (args) => String(args[0] ?? "").toUpperCase(),
  LOWER: (args) => String(args[0] ?? "").toLowerCase(),
  TRIM: (args) => String(args[0] ?? "").trim(),
  CONTAINS: (args) => {
    const hay = args[0]
    const needle = args[1]
    if (Array.isArray(hay)) return hay.map((x) => String(x)).includes(String(needle))
    return String(hay ?? "").includes(String(needle ?? ""))
  },
  ISEMPTY: (args) => {
    const v = args[0]
    if (v == null || v === "") return true
    if (Array.isArray(v)) return v.length === 0
    return false
  },
  /* 日期（预览近似：以「距 Unix 纪元的天数」承载，便于日期差算术；后端为准） */
  TODAY: () => Math.floor(Date.now() / 86_400_000),
  DATE: (args) => {
    const d = new Date(String(args[0] ?? ""))
    const ms = d.getTime()
    return Number.isNaN(ms) ? NaN : Math.floor(ms / 86_400_000)
  },
}

/** 白名单函数名（校验用） */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS)

/* ============================================================
 * 函数目录（供公式设计器展示：分类 / 签名 / 说明 / 示例）
 * ============================================================ */

export interface FunctionDoc {
  name: string
  /** 点击插入的模板文本（含参数占位） */
  insert: string
  signature: string
  desc: string
  example: string
}

export interface FunctionCategory {
  title: string
  fns: FunctionDoc[]
}

export const FUNCTION_CATALOG: FunctionCategory[] = [
  {
    title: "数学 / 聚合",
    fns: [
      { name: "SUM", insert: "SUM()", signature: "SUM(...值 | 数组)", desc: "求和（自动展开数组）", example: "SUM(items.amount)" },
      { name: "AVG", insert: "AVG()", signature: "AVG(...值 | 数组)", desc: "求平均", example: "AVG(scores)" },
      { name: "MAX", insert: "MAX()", signature: "MAX(...值 | 数组)", desc: "取最大值", example: "MAX(a, b, 10)" },
      { name: "MIN", insert: "MIN()", signature: "MIN(...值 | 数组)", desc: "取最小值", example: "MIN(a, b)" },
      { name: "ROUND", insert: "ROUND(, 2)", signature: "ROUND(数, 小数位=0)", desc: "四舍五入", example: "ROUND(price * qty, 2)" },
      { name: "ABS", insert: "ABS()", signature: "ABS(数)", desc: "绝对值", example: "ABS(a - b)" },
    ],
  },
  {
    title: "逻辑",
    fns: [
      { name: "IF", insert: "IF(, , )", signature: "IF(条件, 真值, 假值)", desc: "条件取值", example: "IF(days > 3, '需审批', '免审')" },
      { name: "AND", insert: "AND(, )", signature: "AND(...条件)", desc: "逻辑与", example: "AND(days > 3, amount > 1000)" },
      { name: "OR", insert: "OR(, )", signature: "OR(...条件)", desc: "逻辑或", example: "OR(urgent, days > 5)" },
      { name: "NOT", insert: "NOT()", signature: "NOT(条件)", desc: "逻辑非", example: "NOT(urgent)" },
    ],
  },
  {
    title: "文本",
    fns: [
      { name: "LEN", insert: "LEN()", signature: "LEN(文本 | 数组)", desc: "长度", example: "LEN(remark) > 10" },
      { name: "CONCAT", insert: "CONCAT(, )", signature: "CONCAT(...文本)", desc: "拼接文本", example: "CONCAT(firstName, lastName)" },
      { name: "UPPER", insert: "UPPER()", signature: "UPPER(文本)", desc: "转大写", example: "UPPER(code)" },
      { name: "LOWER", insert: "LOWER()", signature: "LOWER(文本)", desc: "转小写", example: "LOWER(code)" },
      { name: "TRIM", insert: "TRIM()", signature: "TRIM(文本)", desc: "去首尾空白", example: "TRIM(name)" },
      { name: "CONTAINS", insert: "CONTAINS(, )", signature: "CONTAINS(文本 | 数组, 子串)", desc: "是否包含", example: "CONTAINS(tags, 'vip')" },
      { name: "ISEMPTY", insert: "ISEMPTY()", signature: "ISEMPTY(值)", desc: "是否为空", example: "NOT(ISEMPTY(reason))" },
    ],
  },
  {
    title: "日期",
    fns: [
      { name: "TODAY", insert: "TODAY()", signature: "TODAY()", desc: "今天（距纪元天数，可参与日期差）", example: "TODAY() - DATE(startDate) > 3" },
      { name: "DATE", insert: "DATE()", signature: "DATE(文本)", desc: "解析日期为天数", example: "DATE(endDate) - DATE(startDate)" },
    ],
  },
]

/* ============================================================
 * 对外 API
 * ============================================================ */

/**
 * 求值：解析 `expr` 为 AST 并在 `context` 上遍历求值，返回结果值。
 * 语法/求值错误抛 `FormulaError`。**绝不 new Function/eval**。
 */
export function evaluate(expr: string, context: FormulaContext = {}): unknown {
  const ast = parseFormula(expr)
  return evalNode(ast, context)
}

/**
 * 校验：解析并静态遍历 AST，检查函数是否在白名单内。
 * 返回 `{ ok, error? }`（不求值，故不需要上下文）。空表达式视为「未通过」（携带 error）。
 */
export function validate(expr: string): FormulaValidation {
  const src = expr.trim()
  if (!src) return { ok: false, error: "表达式为空" }
  let ast: AstNode
  try {
    ast = parseFormula(src)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const unknownFn = findUnknownFunction(ast)
  if (unknownFn) return { ok: false, error: `未知函数：${unknownFn}（不在白名单）` }
  return { ok: true }
}

export interface FormulaValidation {
  ok: boolean
  error?: string
}

/** 遍历 AST 找到首个不在白名单的函数名（无则返回 null） */
function findUnknownFunction(node: AstNode): string | null {
  switch (node.t) {
    case "call": {
      if (!FUNCTIONS[node.name]) return node.name
      for (const a of node.args) {
        const found = findUnknownFunction(a)
        if (found) return found
      }
      return null
    }
    case "member":
      return findUnknownFunction(node.obj)
    case "unary":
      return findUnknownFunction(node.arg)
    case "bin": {
      const l = findUnknownFunction(node.left)
      if (l) return l
      return findUnknownFunction(node.right)
    }
    default:
      return null
  }
}
