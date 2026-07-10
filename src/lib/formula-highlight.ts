/**
 * 高级公式编辑器的**纯逻辑内核**（无 React / 无 DOM，可单测）。
 *
 * 供 `src/components/advanced-formula-editor.tsx` 复用：
 *  - `tokenize`：轻量正则分词器 —— 语法高亮层用它把表达式切成彩色 token；
 *    产出 token 的 `value` 拼接后**逐字符等于原串**（含空白），保证高亮层与透明 textarea 对齐。
 *  - `matchCompletions` / `currentIdentifier`：自动补全（模糊匹配 + 光标处标识符定位）。
 *  - `findActiveCall`：参数提示（定位光标所在的函数调用与当前实参位）。
 *  - `analyzeStructure`：取人公式无求值时的「解析结构」摘要。
 *  - `locateError`：把校验器返回的中文错误消息尽量还原成 `errorStart..errorEnd` 区间，
 *    供高亮层标红下划线。
 *
 * 两套编辑器（取人 / 计算）各自把现有函数目录 / 校验器适配成这里的统一形状后复用同一 UI。
 */

/* ============================================================
 * 统一数据契约（组件与内核共享）
 * ============================================================ */

export type TokenKind =
  | "fn"
  | "field"
  | "keyword"
  | "string"
  | "number"
  | "operator"
  | "paren"
  | "comma"
  | "ident"
  | "space"

export interface Token {
  kind: TokenKind
  value: string
  start: number
  end: number
}

/** 函数目录条目（取人 / 计算各自适配成此形状） */
export interface FnDoc {
  name: string
  /** 点击 / 补全时插入的模板文本（含参数占位，光标会落到第一个参数） */
  insertTemplate: string
  signature: string
  category: string
  description: string
  example: string
}

/** 可插入 / 补全的字段 */
export interface FieldRef {
  key: string
  label: string
  isUser?: boolean
}

/** 校验结果（尽量携带错误区间，供高亮层定位标红） */
export interface ValidateResult {
  ok: boolean
  message?: string
  errorStart?: number
  errorEnd?: number
}

/** 求值结果（仅计算公式传入 evaluate 时用于实时预览） */
export interface EvaluateResult {
  ok: boolean
  value?: unknown
  error?: string
}

export interface TokenizeOptions {
  /** 字段 key 集合：命中则着「字段」色 */
  fieldKeys?: readonly string[]
  /** 关键字 / 字面量（true/false/null 等）：命中则着「关键字」色 */
  keywords?: readonly string[]
}

/* ============================================================
 * 词法（高亮分词）
 * ============================================================ */

const MULTI_OPS = ["==", "!=", ">=", "<=", "&&", "||"] as const
const SINGLE_OPS = new Set(["+", "-", "*", "/", "%", ">", "<", "!", "=", "."])

function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r"
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

/**
 * 分词：把 `src` 切成带位置的 token（含空白 token）。
 * 不抛错——即便非法字符也作为 `ident` 原样保留，确保 token 拼接 === src（对齐前提）。
 */
export function tokenize(src: string, opts: TokenizeOptions = {}): Token[] {
  const fieldSet = new Set(opts.fieldKeys ?? [])
  const kwSet = new Set(opts.keywords ?? [])
  const toks: Token[] = []
  const n = src.length
  let i = 0

  const push = (kind: TokenKind, start: number, end: number) => {
    toks.push({ kind, value: src.slice(start, end), start, end })
  }

  while (i < n) {
    const c = src[i]
    const start = i

    // 空白
    if (isSpace(c)) {
      let j = i + 1
      while (j < n && isSpace(src[j])) j++
      push("space", start, j)
      i = j
      continue
    }

    // 字符串（单 / 双引号，含 \\ 转义；缺失结束引号则吃到行尾）
    if (c === "'" || c === '"') {
      const quote = c
      let j = i + 1
      while (j < n && src[j] !== quote) {
        j += src[j] === "\\" ? 2 : 1
      }
      j = j < n ? j + 1 : n // 含闭合引号
      push("string", start, j)
      i = j
      continue
    }

    // 数字（含小数）
    if (c >= "0" && c <= "9") {
      let j = i + 1
      while (j < n && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++
      push("number", start, j)
      i = j
      continue
    }

    // 标识符 / 函数名 / 字段 / 关键字
    if (isIdentStart(c)) {
      let j = i + 1
      while (j < n && isIdentPart(src[j])) j++
      const text = src.slice(i, j)
      // 前瞻：跳过空白后若紧跟 `(` → 视为函数调用位
      let k = j
      while (k < n && isSpace(src[k])) k++
      let kind: TokenKind
      if (src[k] === "(") kind = "fn"
      else if (kwSet.has(text)) kind = "keyword"
      else if (fieldSet.has(text)) kind = "field"
      else kind = "ident"
      push(kind, start, j)
      i = j
      continue
    }

    // 多字符运算符
    const two = src.slice(i, i + 2)
    if ((MULTI_OPS as readonly string[]).includes(two)) {
      push("operator", start, i + 2)
      i += 2
      continue
    }

    // 括号 / 逗号 / 单字符运算符
    if (c === "(" || c === ")") {
      push("paren", start, i + 1)
      i += 1
      continue
    }
    if (c === ",") {
      push("comma", start, i + 1)
      i += 1
      continue
    }
    if (SINGLE_OPS.has(c)) {
      push("operator", start, i + 1)
      i += 1
      continue
    }

    // 未识别字符：原样保留（保证对齐），着 ident 色
    push("ident", start, i + 1)
    i += 1
  }

  return toks
}

/* ============================================================
 * 自动补全
 * ============================================================ */

export interface Completion {
  kind: "fn" | "field"
  /** 展示主标题（函数名 / 字段标签） */
  label: string
  /** 次要说明（签名 / 字段 key） */
  detail: string
  /** 插入文本 */
  insert: string
  fn?: FnDoc
  field?: FieldRef
}

/**
 * 模糊打分：`query` 是否为 `target` 的子序列，命中返回分值（越大越靠前），否则 null。
 * 前缀命中 > 包含命中 > 离散子序列；同档内越短越靠前。
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q === "") return 0
  const idx = t.indexOf(q)
  if (idx === 0) return 1000 - t.length
  if (idx > 0) return 500 - idx - t.length
  // 离散子序列
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  if (qi === q.length) return 100 - t.length
  return null
}

/**
 * 光标处标识符：从 `caret` 向左吃 ident-part，返回 `{ text, start, end }`。
 * 无标识符（或以数字开头）返回 null。
 */
export function currentIdentifier(
  src: string,
  caret: number,
): { text: string; start: number; end: number } | null {
  let s = caret
  while (s > 0 && isIdentPart(src[s - 1])) s--
  if (s === caret) return null
  if (!isIdentStart(src[s])) return null // 纯数字等不触发补全
  return { text: src.slice(s, caret), start: s, end: caret }
}

/**
 * 依 `prefix` 在函数 + 字段中做模糊匹配，返回排序后的候选（函数优先，其次分值）。
 * `prefix` 为空返回空数组（不打扰）。
 */
export function matchCompletions(
  prefix: string,
  fns: readonly FnDoc[],
  fields: readonly FieldRef[],
  limit = 8,
): Completion[] {
  if (prefix.trim() === "") return []
  const scored: { c: Completion; score: number; rank: number }[] = []

  for (const fn of fns) {
    const score = fuzzyScore(prefix, fn.name)
    if (score === null) continue
    scored.push({
      score,
      rank: 0,
      c: { kind: "fn", label: fn.name, detail: fn.signature, insert: fn.insertTemplate, fn },
    })
  }
  for (const f of fields) {
    const byKey = fuzzyScore(prefix, f.key)
    const byLabel = fuzzyScore(prefix, f.label)
    const score = Math.max(byKey ?? -Infinity, byLabel ?? -Infinity)
    if (!Number.isFinite(score)) continue
    scored.push({
      score,
      rank: 1,
      c: { kind: "field", label: f.label, detail: f.key, insert: f.key, field: f },
    })
  }

  scored.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : b.score - a.score))
  return scored.slice(0, limit).map((s) => s.c)
}

/* ============================================================
 * 参数提示
 * ============================================================ */

export interface ActiveCall {
  /** 函数名（匿名括号组为 ""） */
  name: string
  /** 当前实参序号（0 起） */
  argIndex: number
  /** `(` 的位置 */
  open: number
}

/**
 * 定位 `caret` 所在的**最内层**函数调用及当前实参位（用于参数提示）。
 * 忽略字符串内的括号 / 逗号；`fnNames` 传入时只返回白名单内的调用。
 */
export function findActiveCall(
  src: string,
  caret: number,
  fnNames?: readonly string[],
): ActiveCall | null {
  const known = fnNames ? new Set(fnNames) : null
  const stack: ActiveCall[] = []
  const limit = Math.min(caret, src.length)
  let lastIdent: string | null = null
  let lastIdentEnd = -1
  let i = 0

  while (i < limit) {
    const c = src[i]
    // 跳过字符串
    if (c === "'" || c === '"') {
      const quote = c
      i++
      while (i < limit && src[i] !== quote) i += src[i] === "\\" ? 2 : 1
      i++
      lastIdent = null
      continue
    }
    if (isIdentStart(c)) {
      let j = i + 1
      while (j < limit && isIdentPart(src[j])) j++
      lastIdent = src.slice(i, j)
      lastIdentEnd = j
      i = j
      continue
    }
    if (c === "(") {
      const named = lastIdent && src.slice(lastIdentEnd, i).trim() === "" ? lastIdent : ""
      stack.push({ name: named, argIndex: 0, open: i })
      lastIdent = null
      i++
      continue
    }
    if (c === ")") {
      stack.pop()
      lastIdent = null
      i++
      continue
    }
    if (c === ",") {
      if (stack.length) stack[stack.length - 1].argIndex++
      lastIdent = null
      i++
      continue
    }
    if (!isSpace(c)) lastIdent = null
    i++
  }

  for (let s = stack.length - 1; s >= 0; s--) {
    const call = stack[s]
    if (!call.name) continue
    if (known && !known.has(call.name)) continue
    return call
  }
  return null
}

/**
 * 把签名串（如 `IF(条件, 真值, 假值)`）拆成 `{ head, params }`。
 * 无括号则 params 为空。
 */
export function parseSignatureParams(signature: string): { head: string; params: string[] } {
  const m = signature.match(/^([^(]*)\((.*)\)\s*$/)
  if (!m) return { head: signature, params: [] }
  const inner = m[2].trim()
  if (inner === "") return { head: m[1], params: [] }
  return { head: m[1], params: inner.split(",").map((p) => p.trim()) }
}

/* ============================================================
 * 解析结构摘要（取人公式无求值时的「预览」）
 * ============================================================ */

export interface StructureSummary {
  functions: string[]
  fields: string[]
}

/** 从 token 里摘出去重后的函数名与字段引用，供无求值场景展示解析结构。 */
export function analyzeStructure(src: string, opts: TokenizeOptions = {}): StructureSummary {
  const toks = tokenize(src, opts)
  const fns = new Set<string>()
  const fields = new Set<string>()
  for (const t of toks) {
    if (t.kind === "fn") fns.add(t.value)
    else if (t.kind === "field") fields.add(t.value)
  }
  return { functions: [...fns], fields: [...fields] }
}

/* ============================================================
 * 错误定位（消息 → 区间）
 * ============================================================ */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 找不平衡括号：多余的 `)`（extra）或未闭合的 `(`（missing）。忽略字符串内括号。
 */
export function findUnbalancedParen(src: string): { index: number; kind: "extra" | "missing" } | null {
  const opens: number[] = []
  let inStr: string | null = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (c === "\\") {
        i++
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === "'" || c === '"') {
      inStr = c
      continue
    }
    if (c === "(") opens.push(i)
    else if (c === ")") {
      if (opens.length === 0) return { index: i, kind: "extra" }
      opens.pop()
    }
  }
  if (opens.length) return { index: opens[opens.length - 1], kind: "missing" }
  return null
}

/**
 * 尽力把校验器的中文错误消息还原为高亮层可用的 `errorStart..errorEnd` 区间。
 * 覆盖：显式「位置 N」、未知函数名、括号不匹配、未闭合引号；无法定位则返回空对象。
 */
export function locateError(expr: string, message: string): { errorStart?: number; errorEnd?: number } {
  // 1) 显式位置：无法识别的字符：「x」（位置 5）
  const posM = message.match(/位置\s*(\d+)/)
  if (posM) {
    const p = Number(posM[1])
    return { errorStart: p, errorEnd: Math.min(p + 1, expr.length) }
  }

  // 2) 未知函数：NAME（不在白名单）
  const fnM = message.match(/未知函数[：:]\s*([A-Za-z_一-鿿][\w$]*)/)
  if (fnM) {
    const name = fnM[1]
    const call = new RegExp(escapeRe(name) + "\\s*\\(").exec(expr)
    if (call) return { errorStart: call.index, errorEnd: call.index + name.length }
    const idx = expr.indexOf(name)
    if (idx >= 0) return { errorStart: idx, errorEnd: idx + name.length }
  }

  // 3) 未闭合引号
  if (/引号/.test(message)) {
    let inStr: string | null = null
    let startIdx = -1
    for (let i = 0; i < expr.length; i++) {
      const c = expr[i]
      if (inStr) {
        if (c === "\\") {
          i++
          continue
        }
        if (c === inStr) {
          inStr = null
          startIdx = -1
        }
        continue
      }
      if (c === "'" || c === '"') {
        inStr = c
        startIdx = i
      }
    }
    if (inStr !== null && startIdx >= 0) return { errorStart: startIdx, errorEnd: expr.length }
  }

  // 4) 括号不匹配 / 缺少「)」
  if (/括号/.test(message) || /缺少.*[)）]/.test(message)) {
    const bp = findUnbalancedParen(expr)
    if (bp) return { errorStart: bp.index, errorEnd: bp.index + 1 }
  }

  return {}
}
