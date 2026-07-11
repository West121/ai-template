/**
 * 对话视图：消息流（气泡 + 卡片平铺 + 打字三点 + 错误重试 + 欢迎态 + 自动滚底）+ 输入区。
 * 丹青 §1.2/§1.3/§2：md 仅助手消息（mdToHtml→sanitizeHtml→.ai-md 作用域）；用户消息纯文本。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { AlertTriangle, ArrowDown, ArrowUp, CloudOff, Loader2, RotateCw, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { sanitizeHtml } from "@/lib/sanitize"
import { Button } from "@/components/ui/button"
import { mdToHtml } from "./markdown"
import { CardRouter } from "./cards/card-router"
import { LinkCard } from "./cards/simple-cards"
import type { AiMessage } from "./types"

function formatTime(iso?: string): string {
  return iso ? iso.slice(11, 16) : ""
}

/** 助手 markdown 气泡（唯一 md 渲染出口：mdToHtml → sanitizeHtml → .ai-md） */
function AssistantMarkdown({ content }: { content: string }) {
  const html = useMemo(() => sanitizeHtml(mdToHtml(content)), [content])
  return (
    <div
      className="ai-md w-fit min-w-0 rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5"
      // eslint-disable-next-line react/no-danger — mdToHtml 产物已经 sanitizeHtml 净化
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function MessageRow({ message }: { message: AiMessage }) {
  if (message.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] min-w-0 whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-4" />
      </div>
      <div className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-2">
        {message.content && <AssistantMarkdown content={message.content} />}
        {message.cards?.map((c, i) => <CardRouter key={i} card={c} />)}
        {message.createdAt && (
          <time className="px-1 text-[11px] text-muted-foreground">{formatTime(message.createdAt)}</time>
        )}
      </div>
    </div>
  )
}

/** 打字三点（motion-reduce 降级静态） */
function TypingIndicator() {
  return (
    <div className="flex gap-2.5" aria-label="助手正在输入">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-4" />
      </div>
      <div className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3.5 py-3">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s] motion-reduce:animate-none" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s] motion-reduce:animate-none" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none" />
      </div>
    </div>
  )
}

/** 欢迎首屏（空会话）：问候 + link chips 起手式 */
function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Sparkles className="size-6" />
      </div>
      <p className="text-sm font-medium">我是星辰助手</p>
      <p className="max-w-[15rem] text-xs text-muted-foreground">可以帮你查待办、发起审批、看报表。试试下面这些：</p>
      <div className="flex flex-wrap justify-center gap-2">
        {["查我的待办", "本月审批量统计", "我要请假", "你能做什么"].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            className="inline-flex items-center rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t}
          </button>
        ))}
      </div>
      <LinkCard
        card={{
          type: "link",
          items: [
            { title: "我的审批", path: "/workflow/tasks" },
            { title: "发起申请", path: "/workflow/start" },
          ],
        }}
      />
    </div>
  )
}

export interface ChatViewProps {
  messages: AiMessage[]
  sending: boolean
  /** 上次发送失败（展示错误条 + 重试） */
  sendError: boolean
  offline: boolean
  onSend: (text: string) => void
  onRetry: () => void
  /** 面板打开时聚焦输入框 */
  focusSignal: number
}

export function ChatView({ messages, sending, sendError, offline, onSend, onRetry, focusSignal }: ChatViewProps) {
  const [value, setValue] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [stickBottom, setStickBottom] = useState(true)

  // 打开面板 ~300ms（动画后）聚焦输入框（丹青 §5.1）
  useEffect(() => {
    if (focusSignal > 0 && !offline) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 320)
      return () => window.clearTimeout(t)
    }
  }, [focusSignal, offline])

  // 新消息自动滚底（用户上滚时暂停跟随）
  useEffect(() => {
    if (stickBottom && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, sending, sendError, stickBottom])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    setStickBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }, [])

  const send = () => {
    const text = value.trim()
    if (!text || sending || offline) return
    setValue("")
    onSend(text)
    setStickBottom(true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // textarea 自增高（1~5 行）
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }

  return (
    <>
      {/* 消息流 */}
      <div ref={listRef} onScroll={handleScroll} aria-live="polite" className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {offline ? (
          <div className="mx-auto flex max-w-[18rem] items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <CloudOff className="size-4 shrink-0" />
            智能助手需要连接后端服务，当前处于离线演示模式，暂不可用。
          </div>
        ) : messages.length === 0 && !sending ? (
          <Welcome onPick={(t) => onSend(t)} />
        ) : (
          <>
            {messages.map((m, i) => (
              <MessageRow key={i} message={m} />
            ))}
            {sending && <TypingIndicator />}
            {sendError && (
              <div className="flex w-fit max-w-[85%] flex-col gap-2 rounded-2xl rounded-bl-md border border-destructive/40 bg-destructive/5 px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>回复失败，请稍后重试</span>
                </div>
                <Button variant="outline" size="sm" className="h-7 w-fit gap-1.5 text-xs" onClick={onRetry}>
                  <RotateCw className="size-3.5" /> 重试
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 回到底部 */}
      {!stickBottom && (
        <div className="pointer-events-none relative">
          <button
            type="button"
            aria-label="回到底部"
            onClick={() => {
              setStickBottom(true)
              if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
            }}
            className="pointer-events-auto absolute -top-12 right-4 flex size-8 items-center justify-center rounded-full border bg-card shadow-sm hover:bg-accent"
          >
            <ArrowDown className="size-4" />
          </button>
        </div>
      )}

      {/* 输入区 */}
      <div className="shrink-0 border-t p-3">
        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border bg-background px-3 py-2",
            "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
          )}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            disabled={offline || sending}
            placeholder={offline ? "离线模式暂不可用" : "问问星辰助手…（Enter 发送 / Shift+Enter 换行）"}
            onChange={(e) => {
              setValue(e.target.value)
              autoGrow(e.target)
            }}
            onKeyDown={onKeyDown}
            className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <Button size="icon-sm" disabled={!value.trim() || sending || offline} aria-label="发送" onClick={send}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
    </>
  )
}
