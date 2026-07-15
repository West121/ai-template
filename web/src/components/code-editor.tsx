/**
 * 统一高级代码编辑器 `<CodeEditor>`（CodeMirror 6 封装）。全站编代码 / JSON / 表达式统一走此组件。
 *
 * 特性：行号 / 语法高亮 / 括号匹配·自动闭合 / 自动缩进 / 撤销重做；json 带 autocomplete + 实时 lint 标红；
 * 主题跟随 app-store themeMode 自动明暗（复用 isDarkMode）；base 主题透明底 + 等宽，外框（边框/聚焦环）由本组件容器给。
 *
 * 防白屏：value 非字符串一律容错为字符串；扩展工厂 codeEditorExtensions 无副作用；组件轻量、可被 lazy 包。
 */
import { useMemo } from "react"
import ReactCodeMirror from "@uiw/react-codemirror"
import { cn } from "@/lib/utils"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { codeEditorExtensions, type CodeLanguage } from "@/lib/code-editor-cm"

export type { CodeLanguage } from "@/lib/code-editor-cm"

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  /** 语言（默认 text） */
  language?: CodeLanguage
  readOnly?: boolean
  placeholder?: string
  /** 最小高度（默认 8rem） */
  minHeight?: string
  /** 最大高度（默认 24rem，超出滚动） */
  maxHeight?: string
  /** 自动换行 */
  lineWrap?: boolean
  /** 显示行号（默认 true） */
  lineNumbers?: boolean
  className?: string
  ariaLabel?: string
}

export function CodeEditor({
  value,
  onChange,
  language = "text",
  readOnly = false,
  placeholder,
  minHeight = "8rem",
  maxHeight = "24rem",
  lineWrap = false,
  lineNumbers = true,
  className,
  ariaLabel,
}: CodeEditorProps) {
  const dark = isDarkMode(useAppStore((s) => s.themeMode))
  // 防白屏：调用方传进来的 value 可能是 null/对象（脏数据）→ 一律归一为字符串
  const safeValue = typeof value === "string" ? value : value == null ? "" : String(value)

  const extensions = useMemo(
    () => codeEditorExtensions({ language, dark, readOnly, lineNumbers, lineWrap, ariaLabel }),
    [language, dark, readOnly, lineNumbers, lineWrap, ariaLabel],
  )

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        readOnly ? "border-dashed opacity-90" : "border-input",
        className,
      )}
    >
      <ReactCodeMirror
        value={safeValue}
        onChange={readOnly ? undefined : onChange}
        theme="none"
        basicSetup={false}
        extensions={extensions}
        placeholder={placeholder}
        minHeight={minHeight}
        maxHeight={maxHeight}
        editable={!readOnly}
        style={{ minHeight }}
      />
    </div>
  )
}
