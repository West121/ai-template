/**
 * AI 智能助手 · 全局入口（挂 AppLayout，登录后可见）。
 *
 * 丹青 §0.1/§1：右下悬浮球 FAB(z-40) + 桌面**非模态**侧边面板（fixed z-40，无遮罩、不锁 body——
 * navigate 卡跳转后面板保持打开）/ 移动端(<640px) 模态全屏（z-50 + scrim）。
 * 面板本体（含 FormRenderer/卡片/markdown）走 React.lazy 分片：主包只含 FAB 与会话状态，
 * 首次打开面板才加载重依赖。offline：面板内提示"助手需后端"，输入禁用（§1.4）。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import { deleteSession, fetchSessionMessages, fetchSessions, sendChat } from "./api"
import type { AiMessage, AiSession } from "./types"

const AssistantPanel = lazy(() => import("./assistant-panel"))

export function AiAssistant() {
  const offline = useAuthStore((s) => s.offline)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"chat" | "sessions">("chat")

  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [sessionTitle, setSessionTitle] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [sessions, setSessions] = useState<AiSession[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [demo, setDemo] = useState(false)
  const lastSentRef = useRef<string | null>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const [focusSignal, setFocusSignal] = useState(0)

  /* ---- 发送（重试复用：不新增用户气泡） ---- */
  const doSend = useCallback(
    async (text: string, isRetry: boolean) => {
      setSending(true)
      setSendError(false)
      if (!isRetry) {
        setMessages((prev) => [...prev, { role: "USER", content: text, createdAt: new Date().toISOString() }])
      }
      lastSentRef.current = text
      try {
        const res = await sendChat(sessionId, text)
        setDemo(res.demo)
        setSessionId(res.data.sessionId)
        if (!sessionTitle) setSessionTitle(text.slice(0, 20))
        setMessages((prev) => [...prev, ...res.data.messages])
      } catch {
        setSendError(true)
      } finally {
        setSending(false)
      }
    },
    [sessionId, sessionTitle],
  )

  const handleSend = useCallback((text: string) => void doSend(text, false), [doSend])
  const handleRetry = useCallback(() => {
    if (lastSentRef.current) void doSend(lastSentRef.current, true)
  }, [doSend])

  /* ---- 会话管理 ---- */
  const newSession = useCallback(() => {
    setSessionId(undefined)
    setSessionTitle(null)
    setMessages([])
    setSendError(false)
    setView("chat")
    setFocusSignal((n) => n + 1)
  }, [])

  const openSessionList = useCallback(async () => {
    setView("sessions")
    try {
      const res = await fetchSessions()
      setSessions(res.data)
    } catch {
      setSessions([])
    }
  }, [])

  const openSession = useCallback(async (id: string) => {
    try {
      const res = await fetchSessionMessages(id)
      setSessionId(id)
      setMessages(res.data)
      setSessionTitle(null)
      setView("chat")
      setFocusSignal((n) => n + 1)
    } catch {
      toast.error("会话加载失败")
    }
  }, [])

  const removeSession = useCallback(
    async (id: string) => {
      try {
        await deleteSession(id)
        setSessions((prev) => prev.filter((s) => s.id !== id))
        if (id === sessionId) newSession()
        toast.success("会话已删除")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "删除失败")
      }
    },
    [sessionId, newSession],
  )

  /* ---- 开合 ---- */
  const openPanel = () => {
    setOpen(true)
    setFocusSignal((n) => n + 1)
  }
  const closePanel = useCallback(() => {
    setOpen(false)
    // 焦点归还 FAB（丹青 §5.1）
    window.setTimeout(() => fabRef.current?.focus(), 50)
  }, [])

  // Esc 关闭（§5.2）
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closePanel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, closePanel])

  const headerTitle = sessionTitle ?? (messages.length > 0 ? messages[0]?.content.slice(0, 20) : null)

  return (
    <>
      {/* 悬浮球 FAB（面板打开时桌面变形为关闭键、移动端隐藏） */}
      <button
        ref={fabRef}
        type="button"
        aria-label={open ? "关闭星辰助手" : "打开星辰助手"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? closePanel() : openPanel())}
        className={cn(
          "fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none transition-transform duration-150 hover:scale-105 hover:shadow-xl active:scale-95 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:scale-100",
          "max-sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] max-sm:right-4",
          open && "max-sm:pointer-events-none max-sm:opacity-0",
        )}
      >
        {open ? <X className="size-6" /> : <Sparkles className="size-6" />}
      </button>

      {/* 移动端 scrim（模态） */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 animate-in fade-in-0 sm:hidden" onClick={closePanel} aria-hidden />
      )}

      {/* 面板（懒加载分片；打开才挂载） */}
      {open && (
        <Suspense fallback={null}>
          <AssistantPanel
            view={view}
            demo={demo}
            offline={offline}
            headerTitle={headerTitle}
            messages={messages}
            sessions={sessions}
            activeSessionId={sessionId}
            sending={sending}
            sendError={sendError}
            focusSignal={focusSignal}
            onSend={handleSend}
            onRetry={handleRetry}
            onNewSession={newSession}
            onOpenSessionList={() => void openSessionList()}
            onOpenSession={(id) => void openSession(id)}
            onDeleteSession={(id) => void removeSession(id)}
            onBackToChat={() => setView("chat")}
            onClose={closePanel}
          />
        </Suspense>
      )}
    </>
  )
}
