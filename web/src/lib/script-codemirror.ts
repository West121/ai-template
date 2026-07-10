/**
 * 脚本编辑区（Tier 2 · Groovy / JavaScript / Python）的 **CodeMirror 6** 扩展工厂。
 *
 * 与公式编辑器（`@/lib/formula-codemirror`，自定义 StreamLanguage 复用 tokenize）不同，脚本是
 * 通用编程语言，直接复用 `@codemirror/legacy-modes` 内置的成熟语言模式（groovy/javascript/python），
 * 一个包覆盖三语言，走同样的 `StreamLanguage` 通道；对应词法产出标准 `@lezer/highlight` tag，
 * 由亮 / 暗两套 `HighlightStyle` 上色。
 *
 * 提供：行号、当前行高亮、括号匹配 / 自动闭合、缩进（Tab 缩进 + 输入即缩进）、撤销重做、语言随
 * `lang` 切换。基础主题沿用公式编辑区口径（透明底、等宽、聚焦无描边——外框由 shadcn 容器提供），
 * 但补出行号 gutter 样式。
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
  lineNumbers,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language"
import { groovy } from "@codemirror/legacy-modes/mode/groovy"
import { javascript } from "@codemirror/legacy-modes/mode/javascript"
import { python } from "@codemirror/legacy-modes/mode/python"
import { tags as t } from "@lezer/highlight"
import type { ScriptLang } from "@/pages/workflow/designer/flow/model"

/** lang → legacy-mode StreamParser（Groovy 用同族的 groovy 模式；JS/Python 各自模式）。 */
function languageOf(lang: ScriptLang): Extension {
  switch (lang) {
    case "js":
      return StreamLanguage.define(javascript)
    case "python":
      return StreamLanguage.define(python)
    case "groovy":
    default:
      return StreamLanguage.define(groovy)
  }
}

/** 亮 / 暗两套着色（覆盖通用语言常见 token；色值与公式编辑区同源，暗色用更亮档）。 */
const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: "#d97706", fontWeight: "500" },
  { tag: [t.string, t.special(t.string)], color: "#059669" },
  { tag: [t.number, t.bool, t.null], color: "#ea580c" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#94a3b8", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#7c3aed" },
  { tag: [t.definitionKeyword, t.typeName, t.className], color: "#0284c7" },
  { tag: t.propertyName, color: "#0284c7" },
  { tag: [t.operator, t.operatorKeyword], color: "#db2777" },
  { tag: [t.bracket, t.paren, t.brace], color: "#64748b" },
  { tag: t.variableName, color: "var(--foreground)" },
])

const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: "#fbbf24", fontWeight: "500" },
  { tag: [t.string, t.special(t.string)], color: "#34d399" },
  { tag: [t.number, t.bool, t.null], color: "#fb923c" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#64748b", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#a78bfa" },
  { tag: [t.definitionKeyword, t.typeName, t.className], color: "#38bdf8" },
  { tag: t.propertyName, color: "#38bdf8" },
  { tag: [t.operator, t.operatorKeyword], color: "#f472b6" },
  { tag: [t.bracket, t.paren, t.brace], color: "#94a3b8" },
  { tag: t.variableName, color: "var(--foreground)" },
])

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

/** 基础主题：透明底、等宽、聚焦无描边（外框由容器给）；行号 gutter 用 muted 色，当前行淡高亮。 */
function baseTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": { backgroundColor: "transparent", color: "var(--foreground)", fontSize: "12px" },
      ".cm-scroller": { fontFamily: MONO, lineHeight: "1.6", overflow: "auto" },
      ".cm-content": { padding: "6px 0", caretColor: "var(--foreground)" },
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
    },
    { dark },
  )
}

export interface ScriptExtensionsOptions {
  lang: ScriptLang
  dark: boolean
  readOnly?: boolean
}

/** 构建脚本编辑区的完整 CodeMirror 扩展集（配合 `basicSetup={false}` 使用）。 */
export function createScriptExtensions(opts: ScriptExtensionsOptions): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    highlightSpecialChars(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    indentUnit.of("  "),
    languageOf(opts.lang),
    syntaxHighlighting(opts.dark ? darkHighlight : lightHighlight),
    EditorView.editable.of(!opts.readOnly),
    // 只读态：EditorState.readOnly facet（禁编辑但仍可选中复制）。
    EditorState.readOnly.of(!!opts.readOnly),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    baseTheme(opts.dark),
  ]
}
