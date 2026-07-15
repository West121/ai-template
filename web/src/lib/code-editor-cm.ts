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
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers as cmLineNumbers,
  rectangularSelection,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete"
import { linter, lintKeymap } from "@codemirror/lint"
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language"
import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { java } from "@codemirror/lang-java"
import { groovy } from "@codemirror/legacy-modes/mode/groovy"
import { standardSQL } from "@codemirror/legacy-modes/mode/sql"
import { json, jsonParseLinter } from "@codemirror/lang-json"
import { tags as t } from "@lezer/highlight"
import { expressionLanguage } from "@/lib/formula-codemirror"

/** 统一编辑器支持的语言（默认 text）。 */
export type CodeLanguage =
  | "json"
  | "javascript"
  | "typescript"
  | "tsx"
  | "java"
  | "sql"
  | "groovy"
  | "python"
  | "expression"
  | "text"

/**
 * language → 语言扩展（真 Lezer 解析 + 补全 + 折叠；json 默认附带 lint，可关）：
 *  js/ts/tsx → @codemirror/lang-javascript（typescript/jsx 开关）；python → lang-python；java → lang-java；
 *  groovy 无官方 lang 包，沿用 legacy-modes（仅词法着色，无解析补全）；sql 沿用 legacy standardSQL。
 *  `lint`：仅 json 有严格解析 lint——默认开；`lint===false` 时 json 只着色不校验（用于含 {{变量}} 的模板 JSON，避免误报）。
 */
function languageExtension(language: CodeLanguage, lint: boolean | undefined): Extension[] {
  switch (language) {
    case "json":
      // 默认（undefined）开 lint；显式 false 关闭（模板 JSON 含 {{}} 严格校验会误报）
      return lint === false ? [json()] : [json(), linter(jsonParseLinter(), { delay: 300 })]
    case "javascript":
      return [javascript()]
    case "typescript":
      return [javascript({ typescript: true })]
    case "tsx":
      return [javascript({ jsx: true, typescript: true })]
    case "python":
      return [python()]
    case "java":
      return [java()]
    case "groovy":
      return [StreamLanguage.define(groovy)] // 无官方 lang-groovy：legacy-modes 词法着色
    case "sql":
      return [StreamLanguage.define(standardSQL)]
    case "expression":
      return [expressionLanguage()]
    case "text":
    default:
      return []
  }
}

/** 亮 / 暗两套着色（超集：兼容 legacy-modes + 公式 + lang-javascript/python/java 的 Lezer tag）。 */
const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword, t.self], color: "#d97706", fontWeight: "500" },
  { tag: [t.string, t.special(t.string), t.docString], color: "#059669" },
  { tag: [t.regexp], color: "#0891b2" },
  { tag: [t.escape], color: "#c2410c" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#ea580c" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#94a3b8", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: "#7c3aed", fontWeight: "500" },
  { tag: [t.definitionKeyword, t.typeName, t.className, t.namespace, t.typeOperator], color: "#0284c7" },
  { tag: [t.propertyName, t.attributeName], color: "#0284c7" },
  { tag: [t.tagName, t.angleBracket], color: "#dc2626" },
  { tag: [t.meta, t.annotation, t.special(t.variableName)], color: "#9333ea" },
  { tag: [t.operator, t.derefOperator], color: "#db2777" },
  { tag: [t.bracket, t.paren, t.brace, t.separator, t.punctuation], color: "#64748b" },
  { tag: [t.variableName, t.definition(t.variableName), t.local(t.variableName), t.labelName], color: "var(--foreground)" },
])

const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword, t.self], color: "#fbbf24", fontWeight: "500" },
  { tag: [t.string, t.special(t.string), t.docString], color: "#34d399" },
  { tag: [t.regexp], color: "#22d3ee" },
  { tag: [t.escape], color: "#fdba74" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#fb923c" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#64748b", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: "#a78bfa", fontWeight: "500" },
  { tag: [t.definitionKeyword, t.typeName, t.className, t.namespace, t.typeOperator], color: "#38bdf8" },
  { tag: [t.propertyName, t.attributeName], color: "#38bdf8" },
  { tag: [t.tagName, t.angleBracket], color: "#f87171" },
  { tag: [t.meta, t.annotation, t.special(t.variableName)], color: "#c084fc" },
  { tag: [t.operator, t.derefOperator], color: "#f472b6" },
  { tag: [t.bracket, t.paren, t.brace, t.separator, t.punctuation], color: "#94a3b8" },
  { tag: [t.variableName, t.definition(t.variableName), t.local(t.variableName), t.labelName], color: "var(--foreground)" },
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
      // 折叠三角 gutter
      ".cm-foldGutter .cm-gutterElement": { padding: "0 2px", cursor: "pointer", color: "var(--muted-foreground)" },
      ".cm-foldPlaceholder": {
        backgroundColor: "var(--muted)",
        color: "var(--muted-foreground)",
        border: "1px solid var(--border)",
        borderRadius: "4px",
        margin: "0 2px",
        padding: "0 4px",
      },
      // 查找/替换面板 + 匹配高亮 + 选中同项高亮
      ".cm-panels": { backgroundColor: "var(--popover)", color: "var(--popover-foreground)", borderTop: "1px solid var(--border)" },
      ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)", borderTop: "none" },
      ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": { fontSize: "11px" },
      ".cm-panel.cm-search input": {
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
        borderRadius: "4px",
        padding: "2px 6px",
      },
      ".cm-searchMatch": { backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)", borderRadius: "2px" },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in oklab, var(--primary) 45%, transparent)" },
      ".cm-selectionMatch": { backgroundColor: "color-mix(in oklab, var(--primary) 14%, transparent)" },
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
  /** json 严格解析 lint：默认开（仅 json 有效）；模板 JSON（含 {{变量}}）传 false 关闭以免误报 */
  lint?: boolean
  /** 无障碍标签（写到 .cm-content 的 aria-label） */
  ariaLabel?: string
}

/** 构建统一代码编辑器的完整 CodeMirror 扩展集（配合 `basicSetup={false}` 使用）。 */
export function codeEditorExtensions(opts: CodeEditorExtOptions): Extension[] {
  const showLineNumbers = opts.lineNumbers ?? true
  const exts: Extension[] = [
    history(),
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    highlightActiveLine(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    indentUnit.of("  "),
    // IDE 级：折叠 + 查找/替换(Ctrl+F/Ctrl+H) + 选中项高亮 + 多光标(Alt 矩形选、Ctrl+D 选同词)
    codeFolding(),
    search({ top: true }),
    highlightSelectionMatches(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    ...languageExtension(opts.language, opts.lint),
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
      ...searchKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    baseTheme(opts.dark),
  ]
  // 行号 gutter：连带折叠三角与当前行 gutter 高亮（无行号时保持极简、折叠仍可用键位）
  if (showLineNumbers) {
    exts.unshift(cmLineNumbers(), foldGutter(), highlightActiveLineGutter())
  }
  if (opts.lineWrap) exts.push(EditorView.lineWrapping)
  if (opts.ariaLabel) exts.push(EditorView.contentAttributes.of({ "aria-label": opts.ariaLabel }))
  return exts
}
