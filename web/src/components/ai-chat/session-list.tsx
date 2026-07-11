/**
 * 会话列表视图（丹青 §4）：面板内视图切换（不另开抽屉）。
 * 项 = 图标 + 标题(首问摘要) + 相对时间；当前会话高亮；删除走 AlertDialog 二次确认。
 */
import { useState } from "react"
import { MessageSquare, MessagesSquare, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { AiSession } from "./types"

function relativeTime(iso: string): string {
  const t = new Date(iso.replace(" ", "T")).getTime()
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min}分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}小时前`
  const day = Math.floor(hour / 24)
  if (day === 1) return "昨天"
  if (day < 30) return `${day}天前`
  return iso.slice(5, 10).replace("-", "月") + "日"
}

export function SessionListView({
  sessions,
  activeId,
  onOpen,
  onDelete,
  onNew,
}: {
  sessions: AiSession[]
  activeId?: string
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
}) {
  const [deleting, setDeleting] = useState<AiSession | null>(null)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <MessagesSquare className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">还没有会话</p>
          <Button size="sm" className="h-8" onClick={onNew}>
            开始新对话
          </Button>
        </div>
      ) : (
        <ul className="space-y-0.5">
          {sessions.map((s) => (
            <li key={s.id}>
              <div
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-accent",
                  s.id === activeId && "bg-accent",
                )}
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <button type="button" onClick={() => onOpen(s.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{s.title || "（未命名会话）"}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{relativeTime(s.updatedAt)}</p>
                </button>
                <button
                  type="button"
                  aria-label="删除会话"
                  onClick={() => setDeleting(s)}
                  className="shrink-0 rounded p-2 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{deleting?.title || "未命名会话"}」后不可恢复，确定删除吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleting) onDelete(deleting.id)
                setDeleting(null)
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
