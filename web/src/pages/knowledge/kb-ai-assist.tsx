/**
 * 知识库文档 AI 写作辅助（§3.2，批3）：编辑器「AI」下拉入口 + 选区气泡菜单 → 六动作
 * （续写/润色/总结/生成大纲/纠错/翻译）。流式生成先进**预览**（接受/丢弃/重试），确认才落入文档，
 * 不直接改（可控可解释）。生成中可取消 + 打字效果 + 失败 toast。仅 EDITOR/ADMIN（editor 存在即可编）。
 */
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import type { Editor } from "@tiptap/react"
import { Check, RotateCw, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { assistStream } from "./mock"
import { ASSIST_ACTIONS, assistLabel, isReplaceAction, type AssistAction } from "./assist-util"

/** 纯文本 → 段落 HTML（转义，多行成多段） */
function toParagraphs(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => `<p>${esc(l)}</p>`)
    .join("")
}

interface Sel {
  text: string
  from: number
  to: number
}

export function KbAiAssist({ editor, docId }: { editor: Editor | null; docId?: number }) {
  const [sel, setSel] = useState<Sel>({ text: "", from: 0, to: 0 })
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null)
  const [action, setAction] = useState<AssistAction | null>(null)
  const [open, setOpen] = useState(false)
  const [stream, setStream] = useState("")
  const [running, setRunning] = useState(false)
  const cancelRef = useRef<null | (() => void)>(null)
  const runSelRef = useRef<Sel>({ text: "", from: 0, to: 0 })

  // 选区跟踪（气泡菜单锚点）
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { from, to } = editor.state.selection
      const text = from !== to ? editor.state.doc.textBetween(from, to, " ") : ""
      setSel({ text, from, to })
      if (text) {
        try {
          const c = editor.view.coordsAtPos(from)
          setBubble({ top: c.top, left: c.left })
        } catch {
          setBubble(null)
        }
      } else {
        setBubble(null)
      }
    }
    update()
    editor.on("selectionUpdate", update)
    editor.on("transaction", update)
    return () => {
      editor.off("selectionUpdate", update)
      editor.off("transaction", update)
    }
  }, [editor])

  useEffect(() => () => cancelRef.current?.(), [])

  const startStream = (a: AssistAction, useSel: Sel) => {
    cancelRef.current?.()
    setStream("")
    setRunning(true)
    cancelRef.current = assistStream(
      { action: a, selectedText: useSel.text || undefined, docContext: editor?.getText()?.slice(0, 4000), docId },
      {
        onDelta: (c) => setStream((s) => s + c),
        onDone: () => {
          setRunning(false)
          cancelRef.current = null
        },
        onError: (m) => {
          setRunning(false)
          cancelRef.current = null
          toast.error(m)
        },
      },
    )
  }

  const runAction = (a: AssistAction) => {
    const useSel = { ...sel }
    runSelRef.current = useSel
    setAction(a)
    setOpen(true)
    startStream(a, useSel)
  }

  const cancelStream = () => {
    cancelRef.current?.()
    cancelRef.current = null
    setRunning(false)
  }

  const close = () => {
    cancelStream()
    setOpen(false)
    setAction(null)
    setStream("")
  }

  const accept = () => {
    const text = stream.trim()
    const useSel = runSelRef.current
    if (editor && action && text) {
      const html = toParagraphs(text)
      if (isReplaceAction(action) && useSel.from !== useSel.to) {
        editor.chain().focus().insertContentAt({ from: useSel.from, to: useSel.to }, html).run()
      } else if (action === "continue") {
        editor.chain().focus().insertContentAt(useSel.to, html).run()
      } else {
        editor.chain().focus("end").insertContent(html).run()
      }
      toast.success("已插入文档")
    }
    close()
  }

  if (!editor) return null

  return (
    <>
      {/* AI 下拉入口（工具栏级） */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Sparkles className="size-3.5 text-primary" /> AI
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {ASSIST_ACTIONS.map((a) => (
            <DropdownMenuItem key={a.key} disabled={a.needsSelection && !sel.text} onClick={() => runAction(a.key)}>
              <Sparkles className="size-3.5 text-primary" /> {a.label}
              {a.needsSelection && !sel.text && <span className="ml-auto text-[10px] text-muted-foreground">需选中</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 选区气泡菜单（选中文本浮出；onMouseDown 阻止编辑器失焦丢选区） */}
      {sel.text && bubble && !open &&
        createPortal(
          <div
            role="menu"
            aria-label="AI 写作辅助"
            onMouseDown={(e) => e.preventDefault()}
            style={{ position: "fixed", top: Math.max(8, bubble.top - 44), left: bubble.left, zIndex: 50 }}
            className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md"
          >
            <span className="px-1 text-[11px] text-muted-foreground">
              <Sparkles className="inline size-3 text-primary" />
            </span>
            {ASSIST_ACTIONS.filter((a) => a.needsSelection || a.key === "summarize").map((a) => (
              <Button key={a.key} size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => runAction(a.key)}>
                {a.label}
              </Button>
            ))}
          </div>,
          document.body,
        )}

      {/* 预览：流式生成 → 接受/丢弃/重试 */}
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Sparkles className="size-4 text-primary" /> AI 写作辅助 · {action ? assistLabel(action) : ""}
            </DialogTitle>
          </DialogHeader>

          {/* 替换类动作：原文对照（简易 diff 预览） */}
          {action && isReplaceAction(action) && runSelRef.current.text && (
            <div className="rounded-md border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
              <div className="mb-1 font-medium">原文</div>
              <div className="max-h-24 overflow-y-auto whitespace-pre-wrap">{runSelRef.current.text}</div>
            </div>
          )}

          <div className="min-h-[6rem] max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-sm">
            {stream}
            {running && <span className="ml-0.5 inline-block animate-pulse text-muted-foreground">▍</span>}
            {!stream && !running && <span className="text-muted-foreground">未生成内容</span>}
          </div>

          <DialogFooter>
            {running ? (
              <Button variant="outline" className="gap-1.5" onClick={cancelStream}>
                <X className="size-3.5" /> 取消
              </Button>
            ) : (
              <>
                <Button variant="ghost" className="gap-1.5" onClick={() => action && startStream(action, runSelRef.current)}>
                  <RotateCw className="size-3.5" /> 重试
                </Button>
                <Button variant="outline" onClick={close}>
                  丢弃
                </Button>
                <Button className="gap-1.5" disabled={!stream.trim()} onClick={accept}>
                  <Check className="size-3.5" /> 接受
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
