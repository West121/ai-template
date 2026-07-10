/**
 * 富文本工具栏：按启用的 feature 自动出按钮（分组 + 分隔线），shadcn 风格 + Tooltip + aria-label。
 * 表格行列操作仅在光标位于表格内时浮现；图片经隐藏 <input type=file> 触发（上传逻辑由 editor 注入）。
 */
import { Fragment, useEffect, useReducer, useRef, type ComponentType } from "react"
import type { Editor } from "@tiptap/react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Eraser,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  type LucideProps,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { RichTextFeature } from "./extensions"

/* ---------------- 基础按钮 ---------------- */

function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: ComponentType<LucideProps>
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-40",
            active
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />
}

/* ---------------- 文字颜色预设 ---------------- */

const TEXT_COLORS: { label: string; value: string }[] = [
  { label: "默认", value: "" },
  { label: "红色", value: "#dc2626" },
  { label: "橙色", value: "#ea580c" },
  { label: "绿色", value: "#16a34a" },
  { label: "蓝色", value: "#2563eb" },
  { label: "紫色", value: "#9333ea" },
  { label: "灰色", value: "#6b7280" },
]

/* ---------------- 工具栏 ---------------- */

export function RichTextToolbar({
  editor,
  features,
  onPickImage,
}: {
  editor: Editor
  features: RichTextFeature[]
  /** image feature：选中文件后回调（上传/base64 由 editor 层处理） */
  onPickImage?: (file: File) => void
}) {
  const has = (f: RichTextFeature) => features.includes(f)
  const fileRef = useRef<HTMLInputElement>(null)

  // 订阅 transaction 驱动激活态刷新（选区变化 / 格式切换）
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    editor.on("transaction", force)
    return () => {
      editor.off("transaction", force)
    }
  }, [editor])

  const chain = () => editor.chain().focus()

  const setLink = () => {
    if (editor.isActive("link")) {
      chain().unsetLink().run()
      return
    }
    // 轻量交互：prompt 取地址（无新增依赖）；空值即取消
    const url = window.prompt("链接地址", "https://")
    if (url && url.trim() && url.trim() !== "https://") {
      chain().setLink({ href: url.trim() }).run()
    }
  }

  const inTable = has("table") && editor.isActive("table")

  /** 分组渲染：组内无可见按钮时整组（含分隔线）不出现 */
  const groups: React.ReactNode[][] = []

  if (has("undoRedo")) {
    groups.push([
      <ToolButton key="undo" icon={Undo2} label="撤销" disabled={!editor.can().undo()} onClick={() => chain().undo().run()} />,
      <ToolButton key="redo" icon={Redo2} label="重做" disabled={!editor.can().redo()} onClick={() => chain().redo().run()} />,
    ])
  }

  const marks: React.ReactNode[] = []
  if (has("bold")) marks.push(<ToolButton key="bold" icon={Bold} label="加粗" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()} />)
  if (has("italic")) marks.push(<ToolButton key="italic" icon={Italic} label="斜体" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()} />)
  if (has("underline")) marks.push(<ToolButton key="underline" icon={UnderlineIcon} label="下划线" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()} />)
  if (has("strike")) marks.push(<ToolButton key="strike" icon={Strikethrough} label="删除线" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()} />)
  if (has("code")) marks.push(<ToolButton key="code" icon={Code} label="行内代码" active={editor.isActive("code")} onClick={() => chain().toggleCode().run()} />)
  if (has("highlight")) marks.push(<ToolButton key="highlight" icon={Highlighter} label="高亮" active={editor.isActive("highlight")} onClick={() => chain().toggleHighlight().run()} />)
  if (has("subsup")) {
    marks.push(
      <ToolButton key="sub" icon={SubscriptIcon} label="下标" active={editor.isActive("subscript")} onClick={() => chain().toggleSubscript().run()} />,
      <ToolButton key="sup" icon={SuperscriptIcon} label="上标" active={editor.isActive("superscript")} onClick={() => chain().toggleSuperscript().run()} />,
    )
  }
  if (has("color")) {
    marks.push(
      <DropdownMenu key="color">
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="文字颜色"
                onMouseDown={(e) => e.preventDefault()}
                className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Palette className="size-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>文字颜色</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="min-w-28">
          {TEXT_COLORS.map((c) => (
            <DropdownMenuItem
              key={c.label}
              onSelect={() => {
                if (c.value) chain().setColor(c.value).run()
                else chain().unsetColor().run()
              }}
            >
              <span
                className="mr-2 inline-block size-3.5 rounded-full border"
                style={c.value ? { background: c.value } : undefined}
              />
              {c.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>,
    )
  }
  if (marks.length) groups.push(marks)

  const blocks: React.ReactNode[] = []
  if (has("heading")) {
    blocks.push(
      <ToolButton key="h2" icon={Heading2} label="标题 2" active={editor.isActive("heading", { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()} />,
      <ToolButton key="h3" icon={Heading3} label="标题 3" active={editor.isActive("heading", { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()} />,
    )
  }
  if (has("blockquote")) blocks.push(<ToolButton key="quote" icon={Quote} label="引用" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()} />)
  if (has("horizontalRule")) blocks.push(<ToolButton key="hr" icon={Minus} label="分隔线" onClick={() => chain().setHorizontalRule().run()} />)
  if (blocks.length) groups.push(blocks)

  const lists: React.ReactNode[] = []
  if (has("bulletList")) lists.push(<ToolButton key="ul" icon={List} label="无序列表" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()} />)
  if (has("orderedList")) lists.push(<ToolButton key="ol" icon={ListOrdered} label="有序列表" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()} />)
  if (has("taskList")) lists.push(<ToolButton key="task" icon={ListChecks} label="任务列表" active={editor.isActive("taskList")} onClick={() => chain().toggleTaskList().run()} />)
  if (lists.length) groups.push(lists)

  if (has("align")) {
    groups.push([
      <ToolButton key="left" icon={AlignLeft} label="左对齐" active={editor.isActive({ textAlign: "left" })} onClick={() => chain().toggleTextAlign("left").run()} />,
      <ToolButton key="center" icon={AlignCenter} label="居中" active={editor.isActive({ textAlign: "center" })} onClick={() => chain().toggleTextAlign("center").run()} />,
      <ToolButton key="right" icon={AlignRight} label="右对齐" active={editor.isActive({ textAlign: "right" })} onClick={() => chain().toggleTextAlign("right").run()} />,
    ])
  }

  const inserts: React.ReactNode[] = []
  if (has("link")) inserts.push(<ToolButton key="link" icon={LinkIcon} label={editor.isActive("link") ? "移除链接" : "插入链接"} active={editor.isActive("link")} onClick={setLink} />)
  if (has("table")) {
    inserts.push(
      <ToolButton
        key="table"
        icon={TableIcon}
        label="插入表格（3×3）"
        disabled={inTable}
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      />,
    )
  }
  if (has("image")) {
    inserts.push(
      <Fragment key="image">
        <ToolButton icon={ImageIcon} label="插入图片" onClick={() => fileRef.current?.click()} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onPickImage?.(file)
            e.target.value = ""
          }}
        />
      </Fragment>,
    )
  }
  if (inserts.length) groups.push(inserts)

  // 表格内：行列操作组
  if (inTable) {
    groups.push([
      <button key="row+" type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addRowAfter().run()} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label="下方插入行">
        +行
      </button>,
      <button key="col+" type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addColumnAfter().run()} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label="右侧插入列">
        +列
      </button>,
      <button key="row-" type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteRow().run()} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label="删除当前行">
        -行
      </button>,
      <button key="col-" type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteColumn().run()} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label="删除当前列">
        -列
      </button>,
      <ToolButton key="tdel" icon={Trash2} label="删除表格" onClick={() => chain().deleteTable().run()} />,
    ])
  }

  if (has("clearFormat")) {
    groups.push([
      <ToolButton key="clear" icon={Eraser} label="清除格式" onClick={() => chain().clearNodes().unsetAllMarks().run()} />,
    ])
  }

  return (
    <div role="toolbar" aria-label="富文本工具栏" className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
      {groups.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <Divider />}
          {group}
        </Fragment>
      ))}
    </div>
  )
}
