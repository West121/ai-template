/**
 * 文档评论（§2 kb_comment，批4a）：右抽屉 → 评论树（回复）+ 发评论 + @提及（复用 OrgPicker）+ 删自己评论。
 * EDITOR+ 可评论/回复/删，VIEWER 只读看。锚点（选区评论）留待后续，本批文档级评论。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { AtSign, Loader2, MessageSquare, Reply, Send, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { OrgPicker, type OrgRef } from "@/components/org-picker"
import { deleteComment, fetchComments, postComment } from "./mock"
import { buildCommentTree } from "./diff-util"
import type { KbComment, KbCommentNode } from "./types"

function timeOf(iso: string): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : ""
}

export function DocComments({ docId, canEdit }: { docId: number; canEdit: boolean }) {
  const userId = useAuthStore((s) => s.userId)
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<KbComment[]>([])
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState("")
  const [replyTo, setReplyTo] = useState<KbComment | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [posting, setPosting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetchComments(docId)
      .then((r) => setComments(Array.isArray(r.data) ? r.data : []))
      .catch(() => setComments([]))
      .finally(() => setLoading(false))
  }, [docId])
  // 挂载即拉取（供计数）；打开时刷新
  useEffect(() => {
    load()
  }, [load])

  const tree = useMemo(() => buildCommentTree(comments), [comments])

  const post = async () => {
    const content = text.trim()
    if (!content) return
    setPosting(true)
    try {
      await postComment(docId, { content, parentId: replyTo?.id ?? null })
      setText("")
      setReplyTo(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "评论失败")
    } finally {
      setPosting(false)
    }
  }
  const remove = async (c: KbComment) => {
    try {
      await deleteComment(c.id)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败")
    }
  }
  const insertMention = (refs: OrgRef[]) => {
    setPickerOpen(false)
    if (!refs.length) return
    setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${refs.map((r) => `@${r.name}`).join(" ")} `)
  }
  const canDelete = (c: KbComment) => canEdit && (userId == null || c.userId === userId)

  const renderNode = (node: KbCommentNode, depth: number) => (
    <div key={node.id} className={cn(depth > 0 && "ml-5 border-l pl-3")}>
      <div className="py-2">
        <div className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium">{node.userName.slice(0, 1)}</span>
          <span className="text-sm font-medium">{node.userName}</span>
          <span className="text-[11px] text-muted-foreground">{timeOf(node.createdAt)}</span>
          <div className="ml-auto flex items-center gap-0.5">
            {canEdit && (
              <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground" aria-label="回复" onClick={() => setReplyTo(node)}>
                <Reply className="size-3.5" />
              </Button>
            )}
            {canDelete(node) && (
              <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground hover:text-destructive" aria-label="删除评论" onClick={() => void remove(node)}>
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap pl-8 text-sm">{node.content}</p>
      </div>
      {node.replies.map((r) => renderNode(r, depth + 1))}
    </div>
  )

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <MessageSquare className="size-3.5" /> 评论{comments.length > 0 ? ` (${comments.length})` : ""}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>评论</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {loading ? (
              <div className="py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto size-4 animate-spin" />
              </div>
            ) : tree.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">还没有评论{canEdit ? "，来说两句" : ""}</div>
            ) : (
              tree.map((n) => renderNode(n, 0))
            )}
          </div>
          {canEdit && (
            <div className="border-t p-3">
              {replyTo && (
                <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  回复 @{replyTo.userName}
                  <Button variant="ghost" size="icon-sm" className="size-5" aria-label="取消回复" onClick={() => setReplyTo(null)}>
                    <X className="size-3" />
                  </Button>
                </div>
              )}
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="写下你的评论…（可 @ 提及成员）" rows={2} aria-label="评论内容" />
              <div className="mt-2 flex items-center justify-between">
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setPickerOpen(true)}>
                  <AtSign className="size-3.5" /> 提及
                </Button>
                <Button size="sm" className="gap-1.5" disabled={posting || !text.trim()} onClick={() => void post()}>
                  {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} 发送
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <OrgPicker open={pickerOpen} onOpenChange={setPickerOpen} title="@ 提及成员" types={["USER"]} value={[]} onConfirm={insertMention} />
    </>
  )
}
