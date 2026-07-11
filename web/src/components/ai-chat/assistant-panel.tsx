/**
 * 助手面板本体（懒加载分片）：头部（对话/会话列表两态）+ 主体视图。
 * 拆出 assistant.tsx 以保持主包纤细——FormRenderer/卡片/markdown 只在首次打开面板时加载。
 */
import { ArrowLeft, History, Sparkles, SquarePen, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ChatView } from "./chat-view"
import { SessionListView } from "./session-list"
import type { AiMessage, AiSession } from "./types"
import "./ai-chat.css"

export interface AssistantPanelProps {
  view: "chat" | "sessions"
  demo: boolean
  offline: boolean
  headerTitle: string | null
  messages: AiMessage[]
  sessions: AiSession[]
  activeSessionId?: string
  sending: boolean
  sendError: boolean
  focusSignal: number
  onSend: (text: string) => void
  onRetry: () => void
  onNewSession: () => void
  onOpenSessionList: () => void
  onOpenSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onBackToChat: () => void
  onClose: () => void
}

export default function AssistantPanel(p: AssistantPanelProps) {
  return (
    <div
      role="dialog"
      aria-label="星辰智能助手"
      aria-modal={false}
      className={cn(
        "fixed z-40 grid grid-rows-[auto_1fr_auto] bg-background",
        "animate-in duration-300 slide-in-from-right fade-in-0 motion-reduce:animate-none",
        // 桌面：右侧 420px 非模态（无遮罩不锁 body，navigate 后面板保持开）
        "sm:inset-y-0 sm:right-0 sm:w-[420px] sm:border-l sm:shadow-2xl",
        // 移动：模态全屏
        "max-sm:inset-0 max-sm:z-50 max-sm:w-full",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        {p.view === "sessions" ? (
          <>
            <Button variant="ghost" size="icon-sm" aria-label="返回对话" onClick={p.onBackToChat}>
              <ArrowLeft className="size-4" />
            </Button>
            <p className="flex-1 text-sm font-semibold">会话历史</p>
            <Button variant="ghost" size="icon-sm" aria-label="新会话" onClick={p.onNewSession}>
              <SquarePen className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">{p.headerTitle ?? "星辰助手"}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {p.demo ? "演示模式（后端 /api/ai 未接入）" : "AI 生成内容仅供参考"}
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="新会话" onClick={p.onNewSession}>
              <SquarePen className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="会话列表" onClick={p.onOpenSessionList}>
              <History className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="关闭助手" onClick={p.onClose}>
              <X className="size-4" />
            </Button>
          </>
        )}
      </header>

      {p.view === "sessions" ? (
        <>
          <SessionListView
            sessions={p.sessions}
            activeId={p.activeSessionId}
            onOpen={p.onOpenSession}
            onDelete={p.onDeleteSession}
            onNew={p.onNewSession}
          />
          <div />
        </>
      ) : (
        <ChatView
          messages={p.messages}
          sending={p.sending}
          sendError={p.sendError}
          offline={p.offline}
          onSend={p.onSend}
          onRetry={p.onRetry}
          focusSignal={p.focusSignal}
        />
      )}
    </div>
  )
}
