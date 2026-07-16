/**
 * Dev Studio 右栏 AI 助手（批W2，设计稿 §1.5）：嵌入**作用域绑定当前资产**的 ChatView 独立会话。
 * 与全局悬浮面板复用同一套 ChatView / 卡片体系 / sendChatStream 流式链——本文件只是薄发送壳：
 * pageContext 固定 `{featureCode:"dev-studio", entityType:当前资产type, entityId:code}`（后端注入"当前资产"上下文），
 * AI 产 devDiff 卡就在栏内渲染（part-router 已接），确认成功卡内广播 dev-studio:asset-changed → 中栏刷新。
 * 会话独立（不与全局面板混）；防白屏：外层 ErrorBoundary（index.tsx 包）。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Sparkles } from "lucide-react"
import { ChatView } from "@/components/ai-chat/chat-view"
import { AiChatActionsContext } from "@/components/ai-chat/chat-actions"
import type { AiAttachment, AiMessage } from "@/components/ai-chat/types"
import type { AiMessagePart } from "@/components/ai-chat/protocol"
import type { ToolStatusItem } from "@/components/ai-chat/api"
import { useAuthStore } from "@/stores/auth-store"
import type { DevAssetType } from "./dev-studio-api"

const loadApi = () => import("@/components/ai-chat/api")
const loadProtocol = () => import("@/components/ai-chat/protocol")

export function DevStudioAssistantPane({ asset }: { asset: { type: DevAssetType; code: string; name: string } | null }) {
  const offline = useAuthStore((s) => s.offline)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [toolStatuses, setToolStatuses] = useState<ToolStatusItem[]>([])
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const lastSentRef = useRef<{ text: string; attachments: AiAttachment[]; clientMessageId: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 当前资产随点选变化：ref 取最新（发送时才读，不重建回调）
  const assetRef = useRef(asset)
  assetRef.current = asset

  const doSend = useCallback(
    async (text: string, attachments: AiAttachment[], isRetry: boolean) => {
      const [{ sendChatStream }, { friendlyAiError, mergePart, ulid }] = await Promise.all([loadApi(), loadProtocol()])
      const clientMessageId = (isRetry && lastSentRef.current?.clientMessageId) || ulid()
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setSending(true)
      setSendError(null)
      setToolStatuses([])
      if (!isRetry) {
        setMessages((prev) => [...prev, { role: "USER", content: text, attachments: attachments.length ? attachments : undefined, clientMessageId, createdAt: new Date().toISOString() }])
      }
      lastSentRef.current = { text, attachments, clientMessageId }

      const streamOpenRef = { open: false }
      const ensureStreamMsg = () => {
        if (streamOpenRef.open) return
        streamOpenRef.open = true
        setMessages((prev) => [...prev, { role: "ASSISTANT", content: "", parts: [], createdAt: new Date().toISOString() }])
      }
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
        const a = assetRef.current
        const res = await sendChatStream(
          {
            sessionId,
            clientMessageId,
            message: text,
            attachments: attachments.length ? attachments : undefined,
            // 作用域绑定当前资产（契约钉死）：后端据此注入"当前资产"上下文
            pageContext: { featureCode: "dev-studio", entityType: a?.type ?? null, entityId: a?.code ?? null },
          },
          {
            onStarted: () => ensureStreamMsg(),
            onTextDelta: (t) => patchStreamMsg((m) => ({ ...m, content: m.content + t })),
            onPart: (part: AiMessagePart) => patchStreamMsg((m) => ({ ...m, parts: mergePart(m.parts ?? [], part) })),
            onToolStatus: (item) =>
              setToolStatuses((prev) => {
                const i = prev.findIndex((x) => x.id === item.id)
                if (i >= 0) return prev.map((x, xi) => (xi === i ? item : x))
                return [...prev, item]
              }),
            onAssistantMessage: (msg) => {
              streamOpenRef.open = true
              setMessages((prev) => [...prev, msg])
            },
          },
          ac.signal,
        )
        if (res.sessionId) setSessionId(res.sessionId)
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setSendError(friendlyAiError(err, "") || "")
        }
      } finally {
        if (abortRef.current === ac) {
          setSending(false)
          setToolStatuses([])
          abortRef.current = null
        }
      }
    },
    [sessionId],
  )

  // 卸载中止在途流
  useEffect(() => () => abortRef.current?.abort(), [])

  const handleSend = useCallback((text: string, attachments: AiAttachment[]) => void doSend(text, attachments, false), [doSend])
  const handleRetry = useCallback(() => {
    if (lastSentRef.current) void doSend(lastSentRef.current.text, lastSentRef.current.attachments, true)
  }, [doSend])
  const newSession = useCallback(() => {
    abortRef.current?.abort()
    setSessionId(undefined)
    setMessages([])
    setSendError(null)
  }, [])

  const appendAssistantParts = useCallback((content: string, parts: AiMessagePart[]) => {
    setMessages((prev) => [...prev, { role: "ASSISTANT", content, parts, createdAt: new Date().toISOString() }])
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 作用域提示 + 空态引导 */}
      <div className="shrink-0 border-b px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="size-3.5 text-primary" /> AI 改写
          {asset && (
            <span className="min-w-0 truncate font-normal text-muted-foreground">
              · 当前资产：{asset.name}（{asset.code}）
            </span>
          )}
        </p>
        {messages.length === 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {asset ? "对当前资产下指令，AI 会给出改写 diff 供你确认。试试：「把请假流程的天数阈值改成 5」" : "先在左侧选中一个资产，再让 AI 对它改写。"}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <AiChatActionsContext.Provider value={{ appendAssistantParts }}>
          <ChatView
            messages={messages}
            sending={sending}
            toolStatuses={toolStatuses}
            sendError={sendError}
            offline={offline}
            models={[]}
            modelId={null}
            onModelChange={() => {}}
            onSend={handleSend}
            onRetry={handleRetry}
            onNewSession={newSession}
            briefing={null}
            focusSignal={0}
          />
        </AiChatActionsContext.Provider>
      </div>
    </div>
  )
}
