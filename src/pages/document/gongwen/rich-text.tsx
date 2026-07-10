/**
 * 轻量富文本编辑器（受控 contenteditable）。
 *
 * 仓库未内置富文本方案（announcement 用纯 Textarea 分段），公文正文需要加粗/分段/列表等，
 * 故用零依赖的 contenteditable + document.execCommand 实现一个轻量编辑器，输出 HTML（<p>/<strong>/
 * <ol>/<ul>）。渲染侧统一经 sanitizeHtml 净化（见预览与详情），编辑侧无需拦截。
 *
 * 受控要点：仅当外部 value 与 DOM 现值不一致时才回写 innerHTML，避免每次输入重置光标。
 */
import { useEffect, useRef } from "react"
import { Bold, Italic, List, ListOrdered, Pilcrow, Underline } from "lucide-react"
import { cn } from "@/lib/utils"

interface ToolButton {
  cmd: string
  arg?: string
  icon: typeof Bold
  title: string
}

const TOOLS: ToolButton[] = [
  { cmd: "bold", icon: Bold, title: "加粗" },
  { cmd: "italic", icon: Italic, title: "斜体" },
  { cmd: "underline", icon: Underline, title: "下划线" },
  { cmd: "insertUnorderedList", icon: List, title: "无序列表" },
  { cmd: "insertOrderedList", icon: ListOrdered, title: "有序列表" },
  { cmd: "formatBlock", arg: "P", icon: Pilcrow, title: "段落" },
]

export function RichTextEditor({
  value,
  onChange,
  placeholder = "请输入公文正文…",
  className,
  minHeight = 220,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
  minHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  // 受控回写：仅在外部值与 DOM 现值不一致时写入，避免光标跳动
  useEffect(() => {
    const el = ref.current
    if (el && el.innerHTML !== value) el.innerHTML = value
  }, [value])

  const exec = (btn: ToolButton) => {
    ref.current?.focus()
    // execCommand 虽被标注 deprecated，但各浏览器仍支持，适合零依赖轻量编辑器
    document.execCommand(btn.cmd, false, btn.arg)
    if (ref.current) onChange(ref.current.innerHTML)
  }

  const handleInput = () => {
    if (ref.current) onChange(ref.current.innerHTML)
  }

  return (
    <div className={cn("rounded-md border bg-background", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
        {TOOLS.map((btn) => (
          <button
            key={btn.cmd + (btn.arg ?? "")}
            type="button"
            title={btn.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(btn)}
            className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <btn.icon className="size-4" />
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={handleInput}
        data-placeholder={placeholder}
        style={{ minHeight }}
        className={cn(
          "gw-rte prose-sm max-w-none px-3 py-2 text-sm leading-7 outline-none",
          "[&_p]:my-1 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-6",
          "empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
        )}
      />
    </div>
  )
}
