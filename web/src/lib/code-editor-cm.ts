/**
 * 统一代码编辑器（`<CodeEditor>`）的 **CodeMirror 6** 扩展工厂（无 React / 无 JSX，可单测）。
 *
 * 语言收编到一个 `languageExtension(language)`，复用既有底层、不重造：
 *  - json → `@codemirror/lang-json`（autocomplete + jsonParseLinter 校验标红）
 *  - javascript / groovy / python / sql → `@codemirror/legacy-modes`（成熟词法模式，StreamLanguage 通道）
 *  - expression → `@/lib/formula-codemirror` 的 `expressionLanguage`（复用公式分词内核）
 *  - text → 无语言（纯文本）
 *
 * 行号 / 当前行 / 括号匹配·自动闭合 / 自动缩进 / 撤销重做 / 补全键位；亮暗两套 HighlightStyle（超集，
 * 同时覆盖 legacy-modes 与公式 token）。基础主题透明底、等宽、聚焦无描边（外框由容器给）。
 *
 * 禁 any；类型导入一律 import type（verbatimModuleSyntax）。
 */
import { EditorState, type Extension } from "@codemirror/state"
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers as cmLineNumbers,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete"
import { linter, lintKeymap } from "@codemirror/lint"
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language"
import { javascript } from "@codemirror/legacy-modes/mode/javascript"
import { python } from "@codemirror/legacy-modes/mode/python"
import { groovy } from "@codemirror/legacy-modes/mode/groovy"
import { standardSQL } from "@codemirror/legacy-modes/mode/sql"
import { json, jsonParseLinter } from "@codemirror/lang-json"
import { tags as t } from "@lezer/highlight"
import { expressionLanguage } from "@/lib/formula-codemirror"

/** 统一编辑器支持的语言（默认 text）。 */
export type CodeLanguage = "json" | "javascript" | "sql" | "groovy" | "python" | "expression" | "text"

/** language → 语言扩展（json 附带 lint；其余为 StreamLanguage / 空）。 */
function languageExtension(language: CodeLanguage): Extension[] {
  switch (language) {
    case "json":
      return [json(), linter(jsonParseLinter(), { delay: 300 })]
    case "javascript":
      return [StreamLanguage.define(javascript)]
    case "python":
      return [StreamLanguage.define(python)]
    case "groovy":
      return [StreamLanguage.define(groovy)]
    case "sql":
      return [StreamLanguage.define(standardSQL)]
    case "expression":
      return [expressionLanguage()]
    case "text":
    default:
      return []
  }
}

/** 亮 / 暗两套着色（超集：覆盖 legacy-modes 通用 token + 公式的 paren/separator）。 */
const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: "#d97706", fontWeight: "500" },
  { tag: [t.string, t.special(t.string)], color: "#059669" },
  { tag: [t.number, t.bool, t.null], color: "#ea580c" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#94a3b8", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#7c3aed", fontWeight: "500" },
  { tag: [t.definitionKeyword, t.typeName, t.className], color: "#0284c7" },
  { tag: t.propertyName, color: "#0284c7" },
  { tag: [t.operator, t.operatorKeyword], color: "#db2777" },
  { tag: [t.bracket, t.paren, t.brace, t.separator], color: "#64748b" },
  { tag: t.variableName, color: "var(--foreground)" },
])

const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: "#fbbf24", fontWeight: "500" },
  { tag: [t.string, t.special(t.string)], color: "#34d399" },
  { tag: [t.number, t.bool, t.null], color: "#fb923c" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#64748b", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#a78bfa", fontWeight: "500" },
  { tag: [t.definitionKeyword, t.typeName, t.className], color: "#38bdf8" },
  { tag: t.propertyName, color: "#38bdf8" },
  { tag: [t.operator, t.operatorKeyword], color: "#f472b6" },
  { tag: [t.bracket, t.paren, t.brace, t.separator], color: "#94a3b8" },
  { tag: t.variableName, color: "var(--foreground)" },
])

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

/** 基础主题：透明底、等宽、聚焦无描边（外框由容器给）；行号 gutter muted 色，当前行淡高亮，补全/lint 弹层跟随主题。 */
function baseTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": { backgroundColor: "transparent", color: "var(--foreground)", fontSize: "12px" },
      ".cm-scroller": { fontFamily: MONO, lineHeight: "1.6", overflow: "auto" },
      ".cm-content": { padding: "6px 4px", caretColor: "var(--foreground)" },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
      ".cm-placeholder": { color: "var(--muted-foreground)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--muted-foreground)",
        border: "none",
        borderRight: "1px solid var(--border)",
      },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 8px", minWidth: "1.8rem" },
      ".cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--muted) 60%, transparent)" },
      ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--muted) 40%, transparent)" },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
        backgroundColor: "color-mix(in oklab, var(--primary) 24%, transparent)",
        outline: "1px solid color-mix(in oklab, var(--primary) 50%, transparent)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: MONO, fontSize: "11px", maxHeight: "12rem" },
      ".cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      },
      ".cm-diagnostic-error": { borderLeft: "3px solid var(--destructive)" },
      ".cm-lintRange-error": { textDecoration: "underline wavy var(--destructive)" },
    },
    { dark },
  )
}

export interface CodeEditorExtOptions {
  language: CodeLanguage
  dark: boolean
  readOnly?: boolean
  /** 显示行号（默认 true） */
  lineNumbers?: boolean
  /** 自动换行 */
  lineWrap?: boolean
  /** 无障碍标签（写到 .cm-content 的 aria-label） */
  ariaLabel?: string
}

/** 构建统一代码编辑器的完整 CodeMirror 扩展集（配合 `basicSetup={false}` 使用）。 */
export function codeEditorExtensions(opts: CodeEditorExtOptions): Extension[] {
  const showLineNumbers = opts.lineNumbers ?? true
  const exts: Extension[] = [
    history(),
    drawSelection(),
    highlightSpecialChars(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    indentUnit.of("  "),
    ...languageExtension(opts.language),
    syntaxHighlighting(opts.dark ? darkHighlight : lightHighlight),
    autocompletion(),
    EditorView.editable.of(!opts.readOnly),
    EditorState.readOnly.of(!!opts.readOnly),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    baseTheme(opts.dark),
  ]
  if (showLineNumbers) {
    exts.unshift(cmLineNumbers(), highlightActiveLine(), highlightActiveLineGutter())
  }
  if (opts.lineWrap) exts.push(EditorView.lineWrapping)
  if (opts.ariaLabel) exts.push(EditorView.contentAttributes.of({ "aria-label": opts.ariaLabel }))
  return exts
}
