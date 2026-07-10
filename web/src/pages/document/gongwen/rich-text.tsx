/**
 * 公文正文富文本编辑器（TipTap / ProseMirror）。
 *
 * 取代旧的手写 contenteditable + `document.execCommand`（已废弃、回车插入脏 <br>/<div> 导致正文
 * 出现字面 <br>）。TipTap 3.x（React 19 兼容，peer react ^19）产出**干净的 <p> HTML**：
 * 回车 = 新段落 <p>，不产生裸 <br>；加粗/斜体/下划线/有序无序列表/段落工具栏。
 *
 * 受控契约不变：`value`(string HTML) / `onChange(html)`。空文档回传空串（而非 `<p></p>`），
 * 便于上层 `content.trim() || undefined` 判空。渲染侧统一经 sanitizeHtml 净化。
 */
import { useEffect, type CSSProperties } from "react"
import { Bold, Italic, List, ListOrdered, Pilcrow, Underline as UnderlineIcon } from "lucide-react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { cn } from "@/lib/utils"
import "./rich-text.css"

interface ToolButton {
  icon: typeof Bold
  title: string
  /** 判定激活态高亮 */
  active: (e: Editor) => boolean
  run: (e: Editor) => void
}

const TOOLS: ToolButton[] = [
  { icon: Bold, title: "加粗", active: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
  { icon: Italic, title: "斜体", active: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
  { icon: UnderlineIcon, title: "下划线", active: (e) => e.isActive("underline"), run: (e) => e.chain().focus().toggleUnderline().run() },
  { icon: List, title: "无序列表", active: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { icon: ListOrdered, title: "有序列表", active: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { icon: Pilcrow, title: "段落", active: (e) => e.isActive("paragraph"), run: (e) => e.chain().focus().setParagraph().run() },
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
  const editor = useEditor({
    extensions: [
      // 收敛为公文正文需要的元素：段落 / 加粗 / 斜体 / 下划线 / 有序无序列表；关掉标题/引用/代码/横线/链接
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        link: false,
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: cn(
          "gw-rte prose-sm max-w-none px-3 py-2 text-sm leading-7 text-foreground outline-none",
          "[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-6",
        ),
      },
    },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
  })

  // 受控同步：外部 value 与编辑器现值不一致时回写（emitUpdate:false 避免回环 / 光标跳动）
  useEffect(() => {
    if (!editor) return
    const current = editor.isEmpty ? "" : editor.getHTML()
    if ((value || "") !== current) editor.commands.setContent(value || "", { emitUpdate: false })
  }, [value, editor])

  return (
    <div className={cn("rounded-md border bg-background focus-within:border-ring", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
        {TOOLS.map((btn) => {
          const on = editor ? btn.active(editor) : false
          return (
            <button
              key={btn.title}
              type="button"
              title={btn.title}
              aria-label={btn.title}
              aria-pressed={on}
              disabled={!editor}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor && btn.run(editor)}
              className={cn(
                "flex size-7 items-center justify-center rounded transition-colors",
                on
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <btn.icon className="size-4" />
            </button>
          )
        })}
      </div>
      <EditorContent editor={editor} style={{ "--gw-rte-min": `${minHeight}px` } as CSSProperties} />
    </div>
  )
}
