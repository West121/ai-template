/**
 * AI 智能助手 · 全局入口（挂 AppLayout，登录后可见）。
 *
 * 丹青 §0.1/§1：右下悬浮球 FAB(z-40) + 桌面**非模态**侧边面板（fixed z-40，无遮罩、不锁 body——
 * navigate 卡跳转后面板保持打开）/ 移动端(<640px) 模态全屏（z-50 + scrim）。
 * 面板本体（含 FormRenderer/卡片/markdown）走 React.lazy 分片：主包只含 FAB 与会话状态，
 * 首次打开面板才加载重依赖。offline：面板内提示"助手需后端"，输入禁用（§1.4）。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import type { ToolStatusItem } from "./api"
import type { AiMessagePart } from "./protocol"
import { AiChatActionsContext, type AiChatActions } from "./chat-actions"
import type { AiAttachment, AiBriefing, AiMemory, AiMessage, AiModelChoice, AiSession } from "./types"

const AssistantPanel = lazy(() => import("./assistant-panel"))
/** API/协议层（SSE 客户端/解析器/mock）随首次使用懒加载——主包只留 FAB 与会话壳（分片纪律） */
const loadApi = () => import("./api")
const loadProtocol = () => import("./protocol")

export function AiAssistant() {
  const offline = useAuthStore((s) => s.offline)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"chat" | "sessions" | "memories">("chat")

  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [sessionTitle, setSessionTitle] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [sessions, setSessions] = useState<AiSession[]>([])
  const [sending, setSending] = useState(false)
  /** null=无错误；有值=失败文案（§22 错误码文案化呈现） */
  const [sendError, setSendError] = useState<string | null>(null)
  /** 流式过程中的工具状态条（tool.* 事件驱动） */
  const [toolStatuses, setToolStatuses] = useState<ToolStatusItem[]>([])
  const [demo, setDemo] = useState(false)
  /** 重试沿用同一 clientMessageId（服务端幂等去重） */
  const lastSentRef = useRef<{ text: string; attachments: AiAttachment[]; clientMessageId: string } | null>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const [focusSignal, setFocusSignal] = useState(0)

  /* ---- V2 模型档案（§4.3）：FAST/STANDARD/REASONING/VISION；端点 404 回退旧凭据；会话内记忆 ---- */
  const [models, setModels] = useState<AiModelChoice[]>([])
  const [modelId, setModelId] = useState<string | null>(null)
  const modelBySessionRef = useRef(new Map<string, string | null>())
  const modelsLoadedRef = useRef(false)

  useEffect(() => {
    if (!open || offline || modelsLoadedRef.current) return
    modelsLoadedRef.current = true
    void loadApi()
      .then((m) => m.fetchModelProfiles())
      .then((res) => setModels(res.data))
      .catch(() => setModels([]))
  }, [open, offline])

  const changeModel = useCallback(
    (id: string | null) => {
      setModelId(id)
      if (sessionId) modelBySessionRef.current.set(sessionId, id)
    },
    [sessionId],
  )

  /* ---- 批D 亮点⑤ 主动晨报：每日首次打开面板拉取，置顶简报卡（当日关闭次日恢复） ---- */
  const [briefing, setBriefing] = useState<AiBriefing | null>(null)
  const briefingLoadedRef = useRef(false)
  useEffect(() => {
    if (!open || offline || briefingLoadedRef.current) return
    briefingLoadedRef.current = true
    void import("./panel-logic").then(({ shouldShowBriefing, todayStr, BRIEFING_DISMISS_KEY }) => {
      let dismissed: string | null = null
      try {
        dismissed = localStorage.getItem(BRIEFING_DISMISS_KEY)
      } catch {
        /* 隐私模式忽略 */
      }
      if (!shouldShowBriefing(dismissed, todayStr())) return
      void loadApi()
        .then((m) => m.fetchBriefing())
        .then((res) => setBriefing(res.data))
        .catch(() => setBriefing(null))
    })
  }, [open, offline])
  const dismissBriefing = useCallback(() => {
    setBriefing(null)
    void import("./panel-logic").then(({ todayStr, BRIEFING_DISMISS_KEY }) => {
      try {
        localStorage.setItem(BRIEFING_DISMISS_KEY, todayStr())
      } catch {
        /* 忽略 */
      }
    })
  }, [])

  /* ---- 批D §13.4 长期记忆管理 ---- */
  const [memories, setMemories] = useState<AiMemory[]>([])
  const [memoriesLoading, setMemoriesLoading] = useState(false)
  const openMemories = useCallback(async () => {
    setView("memories")
    setMemoriesLoading(true)
    try {
      const res = await loadApi().then((m) => m.fetchMemories())
      setMemories(res.data)
    } catch {
      setMemories([])
    } finally {
      setMemoriesLoading(false)
    }
  }, [])
  const removeMemory = useCallback(async (id: string) => {
    try {
      await loadApi().then((m) => m.deleteMemory(id))
      setMemories((prev) => prev.filter((x) => x.id !== id))
      toast.success("已删除该记忆")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }, [])

  /* ---- 发送（V2 流式：SSE 事件驱动 UI；重试复用同一 clientMessageId，不新增用户气泡） ---- */
  const doSend = useCallback(
    async (text: string, attachments: AiAttachment[], isRetry: boolean) => {
      const [{ sendChatStream }, { friendlyAiError, mergePart, ulid }, { featureCodeFromPath }] = await Promise.all([
        loadApi(),
        loadProtocol(),
        import("./route-registry"),
      ])
      const clientMessageId = (isRetry && lastSentRef.current?.clientMessageId) || ulid()
      setSending(true)
      setSendError(null)
      setToolStatuses([])
      if (!isRetry) {
        setMessages((prev) => [
          ...prev,
          {
            role: "USER",
            content: text,
            attachments: attachments.length ? attachments : undefined,
            clientMessageId,
            createdAt: new Date().toISOString(),
          },
        ])
      }
      lastSentRef.current = { text, attachments, clientMessageId }

      /** 本轮「思考」步骤累积（用于完成后写进落地消息 thinking，可回看）——state 异步，用本地数组做快照源 */
      const collectedTools: ToolStatusItem[] = []
      /** 流式助手消息占位是否已建（started/首个增量时建，失败前无空气泡） */
      const streamOpenRef = { open: false }
      const ensureStreamMsg = () => {
        if (streamOpenRef.open) return
        streamOpenRef.open = true
        setMessages((prev) => [...prev, { role: "ASSISTANT", content: "", parts: [], createdAt: new Date().toISOString() }])
      }
      /** 修改最后一条流式助手消息 */
      const patchStreamMsg = (fn: (m: AiMessage) => AiMessage) => {
        ensureStreamMsg()
        setMessages((prev) => {
          const next = [...prev]
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "ASSISTANT") {
              next[i] = fn(next[i])
              break
            }
          }
          return next
        })
      }

      try {
        const selected = models.find((m) => m.id === modelId)
        const res = await sendChatStream(
          {
            sessionId,
            clientMessageId,
            message: text,
            // V2 档案优先；回退条目（legacyCredentialId）走旧协议字段
            modelProfileId: selected && selected.legacyCredentialId == null ? selected.id : undefined,
            credentialId: selected?.legacyCredentialId,
            model: selected?.legacyModel,
            attachments: attachments.length ? attachments : undefined,
            // 批C pageContext：当前路由反查 Registry（拿不到发 null）
            pageContext: { featureCode: featureCodeFromPath(window.location.pathname), entityType: null, entityId: null },
          },
          {
            onStarted: () => ensureStreamMsg(),
            onTextDelta: (t) => patchStreamMsg((m) => ({ ...m, content: m.content + t })),
            // 同 partId 覆盖更新（计划卡逐步打勾等），否则追加
            onPart: (part) => patchStreamMsg((m) => ({ ...m, parts: mergePart(m.parts ?? [], part) })),
            onToolStatus: (item) => {
              // 累积快照（完成后落地 message.thinking）：同 id 覆盖，否则追加
              const ci = collectedTools.findIndex((x) => x.id === item.id)
              if (ci >= 0) collectedTools[ci] = item
              else collectedTools.push(item)
              setToolStatuses((prev) => {
                const i = prev.findIndex((x) => x.id === item.id)
                if (i >= 0) return prev.map((x, xi) => (xi === i ? item : x))
                return [...prev, item]
              })
            },
            // 回退路径（旧阻塞端点）：整条消息（旧 cards 形状）直接追加
            onAssistantMessage: (msg) => {
              streamOpenRef.open = true
              setMessages((prev) => [...prev, msg])
            },
          },
        )
        setDemo(res.demo)
        // 完成：把本轮工具步骤快照写进落地助手消息 thinking（收成一行可回看；无工具则不写）
        if (streamOpenRef.open && collectedTools.length) {
          patchStreamMsg((m) => ({ ...m, thinking: collectedTools.slice() }))
        }
        if (res.sessionId) {
          setSessionId(res.sessionId)
          modelBySessionRef.current.set(res.sessionId, modelId)
        }
        if (!sessionTitle) setSessionTitle(text.slice(0, 20) || "附件对话")
      } catch (err) {
        // 业务失败：§22 错误码/明确文案；已产生的流式局部内容保留
        setSendError(friendlyAiError(err, "") || "")
      } finally {
        setSending(false)
        setToolStatuses([])
      }
    },
    [sessionId, sessionTitle, models, modelId],
  )

  const handleSend = useCallback((text: string, attachments: AiAttachment[]) => void doSend(text, attachments, false), [doSend])
  const handleRetry = useCallback(() => {
    if (lastSentRef.current) void doSend(lastSentRef.current.text, lastSentRef.current.attachments, true)
  }, [doSend])

  /* ---- 会话管理 ---- */
  const newSession = useCallback(() => {
    setSessionId(undefined)
    setSessionTitle(null)
    setMessages([])
    setSendError(null)
    setView("chat")
    setFocusSignal((n) => n + 1)
  }, [])

  const openSessionList = useCallback(async () => {
    setView("sessions")
    try {
      const res = await loadApi().then((m) => m.fetchSessions())
      setSessions(res.data)
    } catch {
      setSessions([])
    }
  }, [])

  const openSession = useCallback(async (id: string) => {
    try {
      const res = await loadApi().then((m) => m.fetchSessionMessages(id))
      setSessionId(id)
      setMessages(res.data)
      setSessionTitle(null)
      setSendError(null)
      // 会话级模型记忆：切回会话恢复其选择
      setModelId(modelBySessionRef.current.get(id) ?? null)
      setView("chat")
      setFocusSignal((n) => n + 1)
    } catch {
      toast.error("会话加载失败")
    }
  }, [])

  const removeSession = useCallback(
    async (id: string) => {
      try {
        await loadApi().then((m) => m.deleteSession(id))
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

  /* ---- 批C：消息流动作（图表下钻结果追加为新 list 卡） ---- */
  const chatActions = useMemo<AiChatActions>(
    () => ({
      appendAssistantParts: (content: string, parts: AiMessagePart[]) => {
        setMessages((prev) => [...prev, { role: "ASSISTANT", content, parts, createdAt: new Date().toISOString() }])
      },
    }),
    [],
  )

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
          <AiChatActionsContext.Provider value={chatActions}>
          <AssistantPanel
            view={view}
            demo={demo}
            offline={offline}
            headerTitle={headerTitle}
            messages={messages}
            sessions={sessions}
            activeSessionId={sessionId}
            sending={sending}
            toolStatuses={toolStatuses}
            sendError={sendError}
            models={models}
            modelId={modelId}
            onModelChange={changeModel}
            briefing={briefing}
            onDismissBriefing={dismissBriefing}
            memories={memories}
            memoriesLoading={memoriesLoading}
            onOpenMemories={() => void openMemories()}
            onDeleteMemory={(id) => void removeMemory(id)}
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
          </AiChatActionsContext.Provider>
        </Suspense>
      )}
    </>
  )
}
