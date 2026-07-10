/**
 * 用 **CodeMirror 6** 承载高级公式编辑区的扩展工厂（无 React / 无 JSX，可单测）。
 *
 * 全部着色 / 补全 / 校验能力都由 `@/lib/formula-highlight` 的**纯逻辑内核**驱动，
 * 不在 CodeMirror 侧重造词法 / 匹配 / 定位：
 *  - 语法着色：`StreamLanguage` 的 `StreamParser` 每行调用现有 `tokenize`，把 token 种类
 *    映射到 `@lezer/highlight` 的 tag，再由亮 / 暗两套 `HighlightStyle` 上色（匹配站点 token）。
 *  - 自动补全：`autocompletion({ override })` 的 source 复用 `currentIdentifier` + `matchCompletions`
 *    （函数 + 字段模糊匹配），函数补全插入模板并把光标落到第一个参数。
 *  - lint 校验：`linter` 把外部 `validate(expr)` 返回的 `{errorStart,errorEnd,message}` 映射为
 *    `Diagnostic`，错误区间显示波浪红下划线。
 *
 * 参数提示（signature help）CodeMirror 无内置，仍由组件侧的底部提示条用
 * `findActiveCall` + `parseSignatureParams` 承担，本文件不涉及。
 */
import type { Extension } from "@codemirror/state"
import { EditorView, drawSelection, highlightSpecialChars, keymap } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  pickedCompletion,
  type Completion as CmCompletion,
  type CompletionSource,
} from "@codemirror/autocomplete"
import { linter, lintKeymap, type Diagnostic } from "@codemirror/lint"
import {
  bracketMatching,
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
  type StringStream,
} from "@codemirror/language"
import { tags as t } from "@lezer/highlight"
import type { Tag } from "@lezer/highlight"
import {
  currentIdentifier,
  matchCompletions,
  tokenize,
  type FieldRef,
  type FnDoc,
  type Token,
  type TokenKind,
  type ValidateResult,
} from "@/lib/formula-highlight"

/* ============================================================
 * 语法着色（StreamLanguage ← 复用 tokenize）
 * ============================================================ */

/** 函数调用位的复合 tag（`function` 修饰 `variableName`），HighlightStyle 单独取色。 */
const FN_TAG = t.function(t.variableName)

/** token 种类 → lezer tag（返回 kind 字符串，经 tokenTable 解析成 tag）。 */
const TOKEN_TAGS: Record<Exclude<TokenKind, "space">, Tag> = {
  fn: FN_TAG,
  field: t.propertyName,
  keyword: t.keyword,
  string: t.string,
  number: t.number,
  operator: t.operator,
  paren: t.paren,
  comma: t.separator,
  ident: t.variableName,
}

interface StreamState {
  tokens: Token[]
  idx: number
}

/**
 * 逐行复用 `tokenize`：在每行行首整行分词并缓存，随后按序把 token 吐给 CodeMirror。
 * 公式实际为单行，跨行也按行独立着色（不影响正确性）。
 */
function makeStreamParser(fieldKeys: readonly string[], keywords: readonly string[]): StreamParser<StreamState> {
  const opts = { fieldKeys, keywords }
  return {
    name: "oa-formula",
    startState: () => ({ tokens: [], idx: 0 }),
    token(stream: StringStream, state: StreamState): string | null {
      if (stream.sol()) {
        state.tokens = tokenize(stream.string, opts)
        state.idx = 0
      }
      const tok = state.tokens[state.idx]
      if (!tok || tok.end <= stream.pos) {
        stream.skipToEnd()
        return null
      }
      stream.pos = tok.end
      state.idx++
      return tok.kind === "space" ? null : tok.kind
    },
    tokenTable: TOKEN_TAGS,
  }
}

/** 亮 / 暗两套着色（色值对齐站点原 Tailwind token 色，暗色态用更亮的 400 档）。 */
const lightHighlight = HighlightStyle.define([
  { tag: FN_TAG, color: "#7c3aed", fontWeight: "500" },
  { tag: t.propertyName, color: "#0284c7" },
  { tag: t.keyword, color: "#d97706" },
  { tag: t.string, color: "#059669" },
  { tag: t.number, color: "#ea580c" },
  { tag: t.operator, color: "#db2777" },
  { tag: t.paren, color: "#64748b" },
  { tag: t.separator, color: "#64748b" },
  { tag: t.variableName, color: "var(--foreground)" },
])

const darkHighlight = HighlightStyle.define([
  { tag: FN_TAG, color: "#a78bfa", fontWeight: "500" },
  { tag: t.propertyName, color: "#38bdf8" },
  { tag: t.keyword, color: "#fbbf24" },
  { tag: t.string, color: "#34d399" },
  { tag: t.number, color: "#fb923c" },
  { tag: t.operator, color: "#f472b6" },
  { tag: t.paren, color: "#94a3b8" },
  { tag: t.separator, color: "#94a3b8" },
  { tag: t.variableName, color: "var(--foreground)" },
])

/* ============================================================
 * 自动补全（override source ← 复用 currentIdentifier + matchCompletions）
 * ============================================================ */

/** 函数模板插入后光标落点：第一个 `(` 之后，无则末尾。 */
function templateCaret(tpl: string): number {
  const p = tpl.indexOf("(")
  return p >= 0 ? p + 1 : tpl.length
}

function makeCompletionSource(functions: readonly FnDoc[], fields: readonly FieldRef[]): CompletionSource {
  return (context) => {
    const src = context.state.doc.toString()
    const ident = currentIdentifier(src, context.pos)
    if (!ident) return null
    const items = matchCompletions(ident.text, functions, fields)
    if (items.length === 0) return null

    const options: CmCompletion[] = items.map((c) => {
      if (c.kind === "fn" && c.fn) {
        const tpl = c.fn.insertTemplate
        return {
          label: c.label,
          detail: c.detail,
          type: "function",
          apply: (view, completion, from, to) => {
            view.dispatch({
              changes: { from, to, insert: tpl },
              selection: { anchor: from + templateCaret(tpl) },
              annotations: pickedCompletion.of(completion),
            })
          },
        }
      }
      return { label: c.label, detail: c.detail, type: "variable", apply: c.insert }
    })

    // filter:false —— matchCompletions 已做模糊匹配 + 排序，CodeMirror 不再二次过滤。
    return { from: ident.start, to: ident.end, filter: false, options }
  }
}

/* ============================================================
 * lint 校验（linter ← 复用外部 validate + 内核的 errorStart/errorEnd）
 * ============================================================ */

function makeFormulaLinter(validate: (expr: string) => ValidateResult): (view: EditorView) => Diagnostic[] {
  return (view) => {
    const expr = view.state.doc.toString()
    if (expr.trim() === "") return []
    const r = validate(expr)
    if (r.ok) return []
    const len = expr.length
    let from = Math.max(0, Math.min(r.errorStart ?? 0, len))
    let to = Math.max(from, Math.min(r.errorEnd ?? len, len))
    if (from === to) {
      // 无区间信息时整段标红，避免零宽下划线看不见。
      from = 0
      to = len
    }
    return [{ from, to, severity: "error", message: r.message ?? "语法有误" }]
  }
}

/* ============================================================
 * 基础主题（透明底、等宽、聚焦无描边——外框由 shadcn 容器提供）
 * ============================================================ */

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

function baseTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": { backgroundColor: "transparent", color: "var(--foreground)", fontSize: "12px" },
      ".cm-scroller": { fontFamily: MONO, lineHeight: "1.5", overflow: "auto" },
      ".cm-content": { padding: "8px 12px", caretColor: "var(--foreground)" },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
      ".cm-placeholder": { color: "var(--muted-foreground)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: MONO, fontSize: "11px", maxHeight: "12rem" },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "2px 6px" },
      ".cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      },
      ".cm-completionDetail": { color: "var(--muted-foreground)", fontStyle: "normal", marginLeft: "0.5rem" },
    },
    { dark },
  )
}

/* ============================================================
 * 组装
 * ============================================================ */

export interface FormulaExtensionsOptions {
  functions: readonly FnDoc[]
  fields: readonly FieldRef[]
  validate: (expr: string) => ValidateResult
  keywords?: readonly string[]
  /** 暗色态：切换着色与内建 UI 主题 */
  dark: boolean
}

/** 构建公式编辑区的完整 CodeMirror 扩展集（配合 `basicSetup={false}` 使用）。 */
export function createFormulaExtensions(opts: FormulaExtensionsOptions): Extension[] {
  const fieldKeys = opts.fields.map((f) => f.key)
  const language = StreamLanguage.define(makeStreamParser(fieldKeys, opts.keywords ?? []))
  return [
    history(),
    drawSelection(),
    highlightSpecialChars(),
    bracketMatching(),
    closeBrackets(),
    EditorView.lineWrapping,
    language,
    syntaxHighlighting(opts.dark ? darkHighlight : lightHighlight),
    autocompletion({ override: [makeCompletionSource(opts.functions, opts.fields)] }),
    linter(makeFormulaLinter(opts.validate), { delay: 300 }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
    baseTheme(opts.dark),
  ]
}
