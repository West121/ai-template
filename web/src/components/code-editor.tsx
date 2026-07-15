/**
 * 统一高级代码编辑器 `<CodeEditor>`（CodeMirror 6 封装）。全站编代码 / JSON / 表达式统一走此组件。
 *
 * 特性：行号 / 语法高亮 / 括号匹配·自动闭合 / 自动缩进 / 撤销重做；json 带 autocomplete + 实时 lint 标红；
 * 主题跟随 app-store themeMode 自动明暗（复用 isDarkMode）；base 主题透明底 + 等宽，外框（边框/聚焦环）由本组件容器给。
 * `expandable`：右上角「放大」按钮 → 打开大 Dialog，内嵌**同一受控** CodeEditor（同 value/onChange，实时同步），
 * 弹窗内不再 expandable（防无限递归）。
 *
 * 防白屏：value 非字符串一律容错为字符串；扩展工厂 codeEditorExtensions 无副作用；组件轻量、可被 lazy 包。
 */
import { useMemo, useState } from "react"
import ReactCodeMirror from "@uiw/react-codemirror"
import { Maximize2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { codeEditorExtensions, type CodeLanguage } from "@/lib/code-editor-cm"

export type { CodeLanguage } from "@/lib/code-editor-cm"

/** 语言 → 弹窗标题里的中文标识 */
const LANGUAGE_LABEL: Record<CodeLanguage, string> = {
  json: "JSON",
  javascript: "JavaScript",
  typescript: "TypeScript",
  tsx: "TSX",
  java: "Java",
  sql: "SQL",
  groovy: "Groovy",
  python: "Python",
  expression: "表达式",
  text: "文本",
}

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
  /** json 严格解析 lint：默认 json 开、其它语言无 lint；模板 JSON（含 {{变量}}）传 false 关闭以免误报 */
  lint?: boolean
  /** 右上角「放大到弹窗」编辑（内嵌区太小时用）；默认 false */
  expandable?: boolean
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
  lint,
  expandable = false,
  className,
  ariaLabel,
}: CodeEditorProps) {
  const dark = isDarkMode(useAppStore((s) => s.themeMode))
  const [expanded, setExpanded] = useState(false)
  // 防白屏：调用方传进来的 value 可能是 null/对象（脏数据）→ 一律归一为字符串
  const safeValue = typeof value === "string" ? value : value == null ? "" : String(value)

  const extensions = useMemo(
    () => codeEditorExtensions({ language, dark, readOnly, lineNumbers, lineWrap, lint, ariaLabel }),
    [language, dark, readOnly, lineNumbers, lineWrap, lint, ariaLabel],
  )

  return (
    <>
      <div
        className={cn(
          "relative overflow-hidden rounded-md border bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
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
        {expandable && (
          <button
            type="button"
            aria-label="放大编辑"
            title="放大编辑"
            onClick={() => setExpanded(true)}
            className="absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-md border border-border/60 bg-background/70 text-muted-foreground opacity-50 backdrop-blur-sm transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100"
          >
            <Maximize2 className="size-3.5" />
          </button>
        )}
      </div>

      {expandable && (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>编辑代码 · {LANGUAGE_LABEL[language]}</DialogTitle>
            </DialogHeader>
            {/* 同一受控编辑器：弹窗内改 → onChange → parent value 更新 → 内嵌同步；expandable=false 防递归 */}
            <CodeEditor
              value={value}
              onChange={onChange}
              language={language}
              readOnly={readOnly}
              placeholder={placeholder}
              lineWrap={lineWrap}
              lineNumbers={lineNumbers}
              lint={lint}
              ariaLabel={ariaLabel}
              minHeight="62vh"
              maxHeight="62vh"
              expandable={false}
            />
            <DialogFooter>
              <Button onClick={() => setExpanded(false)}>完成</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
