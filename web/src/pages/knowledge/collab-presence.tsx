/**
 * 协同在线状态条（批4b）：在线用户头像（首字母 + 光标色）+ 状态文案。
 * connected → 「协同编辑 · N 人在线」；degraded → 「协同不可用，单人编辑」；connecting → 「连接协同中…」。
 */
import { Loader2, Users, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import type { KbCollabStatus, KbOnlineUser } from "./use-kb-collab"

export function CollabPresence({ status, users, className }: { status: KbCollabStatus; users: KbOnlineUser[]; className?: string }) {
  const list = Array.isArray(users) ? users : []

  if (status === "connecting") {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Loader2 className="size-3.5 animate-spin" /> 连接协同中…
      </div>
    )
  }
  if (status === "degraded") {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)} title="实时协同不可用，已切换为单人编辑（保存仍正常）">
        <WifiOff className="size-3.5" /> 单人编辑
      </div>
    )
  }
  // connected
  return (
    <div className={cn("flex items-center gap-1.5 text-xs", className)}>
      <div className="flex -space-x-1.5">
        {list.slice(0, 5).map((u) => (
          <span
            key={u.clientId}
            title={u.name}
            className="grid size-5 place-items-center rounded-full border-2 border-background text-[10px] font-medium text-white"
            style={{ backgroundColor: u.color }}
          >
            {u.name.slice(0, 1)}
          </span>
        ))}
      </div>
      <span className="flex items-center gap-1 text-muted-foreground">
        <Users className="size-3.5 text-emerald-500" />
        协同编辑 · {list.length} 人在线
      </span>
    </div>
  )
}
