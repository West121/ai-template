/**
 * 对话视图：消息流（气泡 + 卡片平铺 + 打字三点 + 错误重试 + 欢迎态 + 自动滚底）+ 输入区。
 * 丹青 §1.2/§1.3/§2：md 仅助手消息（mdToHtml→sanitizeHtml→.ai-md 作用域）；用户消息纯文本。
 * §11 增强：输入区上方模型选择器（👁 视觉徽标）+ 附件按钮（图片/文本，就地校验与预览，
 * 所选模型不支持视觉时附图就地提示引导切换）；用户气泡回显附件。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react"
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, CloudOff, Eye, FileText, Loader2, Paperclip, RotateCw, Sparkles, X, XCircle } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { sanitizeHtml } from "@/lib/sanitize"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { mdToHtml } from "./markdown"
import { CardRouter } from "./cards/card-router"
import { PartRouter } from "./cards/part-router"
import { LinkCard } from "./cards/simple-cards"
import { MAX_ATTACHMENTS, checkAttachmentFile, formatBytes, needsVisionWarning } from "./attachments"
import type { AiMessagePart } from "./protocol"
import type { ToolStatusItem } from "./api"
import type { AiAttachment, AiMessage, AiModelChoice } from "./types"

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

/** 附件回显（用户气泡内 / 输入区预览通用视觉）：图片缩略图 + 文本 chip */
function AttachmentStrip({ items, onRemove }: { items: AiAttachment[]; onRemove?: (index: number) => void }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((a, i) => (
        <div key={i} className="group/att relative">
          {a.kind === "IMAGE" && a.dataUrl ? (
            <img src={a.dataUrl} alt={a.name} title={a.name} className="size-14 rounded-lg border object-cover" />
          ) : (
            <span className="flex max-w-44 items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5 text-xs">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{a.name}</span>
              {a.size != null && <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(a.size)}</span>}
            </span>
          )}
          {onRemove && (
            <button
              type="button"
              aria-label={`移除附件 ${a.name}`}
              onClick={() => onRemove(i)}
              className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover/att:opacity-100"
            >
              <X className="size-2.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function MessageRow({ message }: { message: AiMessage }) {
  if (message.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] min-w-0 flex-col items-end gap-1.5">
          {message.attachments && message.attachments.length > 0 && <AttachmentStrip items={message.attachments} />}
          {message.content && (
            <div className="min-w-0 whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
              {message.content}
            </div>
          )}
        </div>
      </div>
    )
  }
  // V2：有 parts 优先按 Part 协议渲染（白名单 + 降级）；否则兼容读旧 cards
  const parts = message.parts?.length ? ([...message.parts].sort((a, b) => a.sequenceNo - b.sequenceNo) as AiMessagePart[]) : null
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-4" />
      </div>
      <div className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-2">
        {message.content && <AssistantMarkdown content={message.content} />}
        {parts ? parts.map((p) => <PartRouter key={p.partId} part={p} />) : message.cards?.map((c, i) => <CardRouter key={i} card={c} />)}
        {message.createdAt && (
          <time className="px-1 text-[11px] text-muted-foreground">{formatTime(message.createdAt)}</time>
        )}
      </div>
    </div>
  )
}

/** 工具状态条（§9.2 displayName：正在查询我的待办… ✓/✗），随流式过程更新 */
function ToolStatusBar({ items }: { items: ToolStatusItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="ml-9 flex w-fit min-w-0 flex-col gap-1 rounded-lg border border-dashed bg-muted/30 px-2.5 py-1.5">
      {items.map((t) => (
        <div key={t.id || t.displayName} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t.state === "running" ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          ) : t.state === "done" ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
          ) : (
            <XCircle className="size-3.5 shrink-0 text-destructive" />
          )}
          <span className="min-w-0 truncate">{t.displayName}</span>
        </div>
      ))}
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

/** 文件 → dataURL */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("读取文件失败"))
    reader.readAsDataURL(file)
  })
}

export interface ChatViewProps {
  messages: AiMessage[]
  sending: boolean
  /** 流式过程中的工具状态条（tool.started/completed/failed 驱动） */
  toolStatuses: ToolStatusItem[]
  /** 上次发送失败文案（null=无错误；后端 400 明确文案友好呈现） */
  sendError: string | null
  offline: boolean
  /** V2 模型档案选择（§4.3；回退条目=旧凭据映射）；null=默认 */
  models: AiModelChoice[]
  modelId: string | null
  onModelChange: (id: string | null) => void
  onSend: (text: string, attachments: AiAttachment[]) => void
  onRetry: () => void
  /** 面板打开时聚焦输入框 */
  focusSignal: number
}

export function ChatView({ messages, sending, toolStatuses, sendError, offline, models, modelId, onModelChange, onSend, onRetry, focusSignal }: ChatViewProps) {
  const [value, setValue] = useState("")
  const [pending, setPending] = useState<AiAttachment[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [stickBottom, setStickBottom] = useState(true)

  const selectedModel = models.find((m) => m.id === modelId) ?? null
  const visionWarn = needsVisionWarning(pending, selectedModel)

  // 打开面板 ~300ms（动画后）聚焦输入框（丹青 §5.1）
  useEffect(() => {
    if (focusSignal > 0 && !offline) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 320)
      return () => window.clearTimeout(t)
    }
  }, [focusSignal, offline])

  // 新消息/流式增量自动滚底（用户上滚时暂停跟随）
  useEffect(() => {
    if (stickBottom && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, sending, toolStatuses, sendError, stickBottom])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    setStickBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }, [])

  /* ---- 附件选择：就地校验（类型/大小/数量）→ dataURL → 预览 ---- */
  const onPickFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ""
    let count = pending.length
    for (const file of files) {
      if (count >= MAX_ATTACHMENTS) {
        toast.warning(`一条消息最多 ${MAX_ATTACHMENTS} 个附件`)
        break
      }
      const check = checkAttachmentFile(file.name, file.type, file.size)
      if (!check.ok) {
        toast.error(check.reason)
        continue
      }
      try {
        const dataUrl = await readAsDataUrl(file)
        count += 1
        setPending((prev) =>
          prev.length >= MAX_ATTACHMENTS ? prev : [...prev, { kind: check.kind, name: file.name, dataUrl, size: file.size }],
        )
      } catch {
        toast.error(`读取「${file.name}」失败`)
      }
    }
  }

  const send = () => {
    const text = value.trim()
    if ((!text && pending.length === 0) || sending || offline) return
    setValue("")
    const atts = pending
    setPending([])
    onSend(text, atts)
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
          <Welcome onPick={(t) => onSend(t, [])} />
        ) : (
          <>
            {messages.map((m, i) => (
              <MessageRow key={i} message={m} />
            ))}
            {sending && <ToolStatusBar items={toolStatuses} />}
            {sending && <TypingIndicator />}
            {sendError != null && (
              <div className="flex w-fit max-w-[85%] flex-col gap-2 rounded-2xl rounded-bl-md border border-destructive/40 bg-destructive/5 px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span className="min-w-0 break-words">{sendError || "回复失败，请稍后重试"}</span>
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
      <div className="shrink-0 space-y-2 border-t p-3">
        {/* §11 模型选择器（会话内记忆；👁=支持视觉） */}
        {!offline && models.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={modelId ?? "default"} onValueChange={(v) => onModelChange(v === "default" ? null : v)}>
              <SelectTrigger size="sm" className="h-7 w-fit gap-1.5 border-dashed text-xs text-muted-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认档案</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id} title={m.description}>
                    <span className="flex items-center gap-1.5">
                      {m.name}
                      {m.description && <span className="text-[10px] text-muted-foreground">· {m.description}</span>}
                      {m.supportsVision && <Eye className="size-3 text-emerald-500" aria-label="支持视觉" />}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedModel?.supportsVision && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                <Eye className="size-3" /> 支持图片理解
              </span>
            )}
          </div>
        )}

        {/* 附件预览 + 视觉能力提示 */}
        {pending.length > 0 && (
          <AttachmentStrip items={pending} onRemove={(i) => setPending((prev) => prev.filter((_, x) => x !== i))} />
        )}
        {visionWarn && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" />
            当前模型档案不支持图片，请在上方切换支持视觉（👁）的档案后再发送。
          </div>
        )}

        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border bg-background px-3 py-2",
            "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
          )}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,.txt,.md,.csv,.json,.log,.pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => void onPickFiles(e)}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label="添加附件（图片/文本文件）"
            disabled={offline || sending}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="size-4" />
          </Button>
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
          <Button size="icon-sm" disabled={(!value.trim() && pending.length === 0) || sending || offline} aria-label="发送" onClick={send}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
    </>
  )
}
