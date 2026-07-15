/**
 * 对话视图：消息流（气泡 + 卡片平铺 + 打字三点 + 错误重试 + 欢迎态 + 自动滚底）+ 输入区。
 * 丹青 §1.2/§1.3/§2：md 仅助手消息（mdToHtml→sanitizeHtml→.ai-md 作用域）；用户消息纯文本。
 * §11 增强：输入区上方模型选择器（👁 视觉徽标）+ 附件按钮（图片/文本，就地校验与预览，
 * 所选模型不支持视觉时附图就地提示引导切换）；用户气泡回显附件。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react"
import { AlertTriangle, ArrowDown, ArrowUp, CloudOff, Eye, FileText, Loader2, Mic, Paperclip, RotateCw, Slash, Sparkles, Square, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { sanitizeHtml } from "@/lib/sanitize"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { mdToHtml } from "./markdown"
import { Component, type ErrorInfo, type ReactNode } from "react"
import { CardRouter } from "./cards/card-router"
import { PartRouter } from "./cards/part-router"

/** 卡片级错误边界:单卡渲染崩溃降级为提示块,不炸消息流(一劳永逸防白屏第 3 层) */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ai-chat] card render failed", error, info.componentStack)
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
          此卡片渲染出错，已隔离（其余内容不受影响）
        </div>
      )
    }
    return this.props.children
  }
}
import { LinkCard } from "./cards/simple-cards"
import { BriefingCard } from "./briefing-card"
import { ThinkingBlock } from "./thinking-block"
import { MAX_ATTACHMENTS, checkAttachmentFile, formatBytes, hasUploadingAttachment, imageSrcOf, needsVisionWarning, type PendingAttachment } from "./attachments"
import { filterSlashCommands, type SlashCommand } from "./panel-logic"
import { isSpeechSupported, startSpeech, type SpeechSession } from "./speech"
import { uploadAttachment } from "./api"
import type { AiMessagePart } from "./protocol"
import type { ToolStatusItem } from "./api"
import type { AiAttachment, AiBriefing, AiMessage, AiModelChoice } from "./types"

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

/** 预览/回显条目：AiAttachment 附加上传态（输入区预览时携带；气泡回显时不带） */
type StripItem = AiAttachment & { uploadState?: "uploading" | "done" | "error"; progress?: number }

/** 附件回显（用户气泡内 / 输入区预览通用视觉）：图片缩略图（src 优先服务端 url）+ 文本 chip + 上传态 */
function AttachmentStrip({ items, onRemove }: { items: StripItem[]; onRemove?: (index: number) => void }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((a, i) => {
        const src = imageSrcOf(a)
        const uploading = a.uploadState === "uploading"
        const errored = a.uploadState === "error"
        return (
          <div key={i} className="group/att relative">
            {a.kind === "IMAGE" && src ? (
              <img
                src={src}
                alt={a.name}
                title={a.name}
                className={cn("size-14 rounded-lg border object-cover", uploading && "opacity-60", errored && "ring-1 ring-destructive")}
              />
            ) : (
              <span
                className={cn(
                  "flex max-w-44 items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5 text-xs",
                  uploading && "opacity-70",
                  errored && "border-destructive/50",
                )}
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{a.name}</span>
                {a.size != null && <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(a.size)}</span>}
              </span>
            )}
            {/* 上传中：进度遮罩（图片盖住，chip 右侧转圈） */}
            {uploading && (
              <span
                className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/50 text-[10px] font-medium text-foreground"
                aria-label={`上传中 ${a.progress ?? 0}%`}
              >
                <Loader2 className="mr-0.5 size-3 animate-spin" />
                {a.progress != null ? `${a.progress}%` : ""}
              </span>
            )}
            {/* 上传失败：角标提示（将以内嵌方式发送，兼容期） */}
            {errored && (
              <span
                className="absolute -left-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                title="上传失败，将以内嵌方式发送"
              >
                <AlertTriangle className="size-2.5" />
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
        )
      })}
    </div>
  )
}

/**
 * 修「同一助手回复渲染两遍」：后端把正文既走 message.text.delta（→ message.content）又落一份 text part
 * （→ message.parts），MessageRow 同时渲染 content 与 parts 便重复。渲染时去掉与 content 同文的纯文本 part
 * （保留带引用/citations 的文本 part，它不止是正文）。
 */
function isDuplicateTextPart(part: AiMessagePart, content: string): boolean {
  if (part.partType !== "text") return false
  const payload = (part.payload ?? {}) as { text?: unknown; citations?: unknown }
  const hasCitations = Array.isArray(payload.citations) && payload.citations.length > 0
  const text = typeof payload.text === "string" ? payload.text.trim() : ""
  return !hasCitations && text !== "" && text === content
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
  const contentText = message.content?.trim() ?? ""
  const parts = message.parts?.length
    ? ([...message.parts].sort((a, b) => a.sequenceNo - b.sequenceNo) as AiMessagePart[]).filter(
        (p) => !isDuplicateTextPart(p, contentText),
      )
    : null
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-4" />
      </div>
      <div className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-2">
        {/* 完成态「思考」回看块（并入消息列首；无工具轮次不渲染）——内部无 ml-9，已在内容列内 */}
        {message.thinking?.length ? <ThinkingBlock steps={message.thinking} phase="done" /> : null}
        {message.content && <AssistantMarkdown content={message.content} />}
        {/* 卡片级错误边界(防白屏规约):单张卡渲染崩溃 → 降级小块,绝不炸消息流/面板 */}
        {parts
          ? parts.map((p) => (
              <CardBoundary key={p.partId}>
                <PartRouter part={p} />
              </CardBoundary>
            ))
          : message.cards?.map((c, i) => (
              <CardBoundary key={i}>
                <CardRouter card={c} />
              </CardBoundary>
            ))}
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

/** 斜杠命令面板（亮点⑥）：输入以 "/" 开头唤起，定位输入框上方；上下键选、Enter 发送/触发、Esc 关 */
function SlashPalette({
  commands,
  activeIndex,
  onPick,
  onHover,
}: {
  commands: SlashCommand[]
  activeIndex: number
  onPick: (cmd: SlashCommand) => void
  onHover: (index: number) => void
}) {
  if (commands.length === 0) return null
  return (
    <div
      role="listbox"
      aria-label="斜杠命令"
      className="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-xl border bg-popover shadow-lg"
    >
      <p className="flex items-center gap-1 border-b px-2.5 py-1.5 text-[10px] text-muted-foreground">
        <Slash className="size-3" />
        斜杠命令 · ↑↓ 选择 · Enter 使用 · Esc 关闭
      </p>
      <ul className="max-h-56 overflow-y-auto p-1">
        {commands.map((c, i) => (
          <li key={c.cmd}>
            <button
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              // 用 mousedown 抢在 textarea blur 之前触发
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(c)
              }}
              onMouseEnter={() => onHover(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left",
                i === activeIndex ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-medium text-primary">{c.cmd}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c.desc}</span>
            </button>
          </li>
        ))}
      </ul>
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
  /** 斜杠命令 /新会话 动作 */
  onNewSession: () => void
  /** 主动晨报（亮点⑤）：置顶简报卡；null=不展示 */
  briefing?: AiBriefing | null
  onDismissBriefing?: () => void
  /** 面板打开时聚焦输入框 */
  focusSignal: number
}

export function ChatView({
  messages,
  sending,
  toolStatuses,
  sendError,
  offline,
  models,
  modelId,
  onModelChange,
  onSend,
  onRetry,
  onNewSession,
  briefing,
  onDismissBriefing,
  focusSignal,
}: ChatViewProps) {
  const [value, setValue] = useState("")
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [stickBottom, setStickBottom] = useState(true)
  // 拖拽到输入卡的高亮态（拖拽/粘贴/选择都复用 ingestFiles，零新校验）
  const [dragging, setDragging] = useState(false)

  /* ---- 斜杠命令面板（亮点⑥） ---- */
  const slashCommands = useMemo(() => filterSlashCommands(value), [value])
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const slashOpen = slashCommands.length > 0 && !slashDismissed
  // 输入变化：重置高亮项并重新允许弹出（Esc 关闭后再输入可再唤起）
  useEffect(() => {
    setSlashIndex(0)
    setSlashDismissed(false)
  }, [value])

  /* ---- 语音输入（亮点⑥，Web Speech；不支持则隐藏按钮） ---- */
  const speechSupported = useMemo(() => isSpeechSupported(), [])
  const [recording, setRecording] = useState(false)
  const speechRef = useRef<SpeechSession | null>(null)

  const uploading = hasUploadingAttachment(pending)
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

  const patchPending = useCallback((localId: string, patch: Partial<PendingAttachment>) => {
    setPending((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)))
  }, [])

  /* ---- 附件入库（选择/拖拽/粘贴 三处复用）：就地校验 → dataURL 预览 → 上传得 attachmentId（fileId 化，失败回退 dataUrl） ---- */
  const ingestFiles = async (files: File[]) => {
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
      let dataUrl: string
      try {
        dataUrl = await readAsDataUrl(file)
      } catch {
        toast.error(`读取「${file.name}」失败`)
        continue
      }
      count += 1
      const localId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const item: PendingAttachment = { localId, kind: check.kind, name: file.name, dataUrl, size: file.size, uploadState: "uploading", progress: 0 }
      setPending((prev) => (prev.length >= MAX_ATTACHMENTS ? prev : [...prev, item]))
      // 上传（进度回填）：成功 → attachmentId + url，不再随消息传大图 dataUrl；失败/端点缺失 → 保留 dataUrl 兼容
      void uploadAttachment(file, check.kind, (percent) => patchPending(localId, { progress: percent }))
        .then((res) => {
          patchPending(localId, { uploadState: "done", attachmentId: res.data.attachmentId, url: res.data.url, progress: 100 })
        })
        .catch(() => {
          patchPending(localId, { uploadState: "error", progress: undefined })
          toast.warning(`「${file.name}」上传失败，将以内嵌方式随消息发送`)
        })
    }
  }
  /** file input 选择 → 清值后入库（清值保证可重复选同一文件仍触发 change） */
  const onPickFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ""
    await ingestFiles(files)
  }

  /** 去掉本地态字段 → 发送用 AiAttachment（已上传只带 attachmentId，未上传回退 dataUrl 由 toWireAttachment 处理） */
  const stripPending = (items: PendingAttachment[]): AiAttachment[] =>
    items.map(({ localId: _l, uploadState: _u, progress: _p, ...rest }) => rest)

  const send = () => {
    const text = value.trim()
    if ((!text && pending.length === 0) || sending || offline || uploading) return
    setValue("")
    const atts = pending
    setPending([])
    onSend(text, stripPending(atts))
    setStickBottom(true)
  }

  /* ---- 斜杠命令选中：action 触发 / message 直接发送 ---- */
  const pickSlash = (cmd: SlashCommand) => {
    setSlashDismissed(true)
    if (cmd.action === "new-session") {
      setValue("")
      setPending([])
      onNewSession()
      return
    }
    if (cmd.message) {
      if (sending || offline || uploading) return
      setValue("")
      const atts = pending
      setPending([])
      onSend(cmd.message, stripPending(atts))
      setStickBottom(true)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % slashCommands.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + slashCommands.length) % slashCommands.length)
        return
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        pickSlash(slashCommands[slashIndex] ?? slashCommands[0])
        return
      }
      if (e.key === "Escape") {
        // 只关面板，不冒泡到 window（避免连带关闭整个助手面板）
        e.preventDefault()
        e.stopPropagation()
        setSlashDismissed(true)
        return
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  /** "命令"chip：把 "/" 填入并聚焦，唤起斜杠面板（再加一个唤起入口，键控/面板逻辑不变） */
  const insertSlash = () => {
    if (offline || sending) return
    setValue((v) => (v.startsWith("/") ? v : `/${v}`))
    setSlashDismissed(false)
    inputRef.current?.focus()
  }

  /* ---- 语音输入：切换录音；识别结果拼到当前文本；失败 toast 降级 ---- */
  const voiceBaseRef = useRef("")
  const stopVoice = useCallback(() => {
    speechRef.current?.stop()
    speechRef.current = null
    setRecording(false)
  }, [])
  const toggleVoice = () => {
    if (recording) {
      stopVoice()
      return
    }
    voiceBaseRef.current = value.trim()
    const session = startSpeech({
      onText: (text) => setValue(voiceBaseRef.current ? `${voiceBaseRef.current} ${text}` : text),
      onError: (msg) => {
        toast.error(msg === "not-allowed" || msg === "service-not-allowed" ? "麦克风权限被拒绝" : "语音识别失败，请重试")
        stopVoice()
      },
      onEnd: () => {
        speechRef.current = null
        setRecording(false)
      },
    })
    if (!session) {
      toast.error("当前浏览器不支持语音输入")
      return
    }
    speechRef.current = session
    setRecording(true)
  }
  // 组件卸载/关闭面板时停止录音，避免麦克风悬挂
  useEffect(() => () => speechRef.current?.stop(), [])

  // textarea 自增高（~5 行，上限对齐卡内 max-h-40=160px）
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }
  // 程序化改文本（语音/斜杠回填）后同步高度
  useEffect(() => {
    if (inputRef.current) autoGrow(inputRef.current)
  }, [value])

  return (
    <>
      {/* 消息流 */}
      <div ref={listRef} onScroll={handleScroll} aria-live="polite" className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* 亮点⑤ 主动晨报：置顶简报卡（每日首次；行可点跳转；今日不再显示）；坏 payload 就地隔离，不炸消息流 */}
        {!offline && briefing && onDismissBriefing && (
          <CardBoundary>
            <BriefingCard briefing={briefing} onDismiss={onDismissBriefing} />
          </CardBoundary>
        )}
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
            {/* 流式期：有工具→单一呼吸「思考块」（呼吸头即进度，不再叠三点）；纯思考无工具→保留三点 */}
            {sending &&
              (toolStatuses.length > 0 ? (
                <div className="ml-9">
                  <ThinkingBlock steps={toolStatuses} phase="active" />
                </div>
              ) : (
                <TypingIndicator />
              ))}
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

      {/* 输入区：一体化输入卡（附件 / 输入 / 工具栏 竖三层，focus-within 主色描边=激活即高级） */}
      <div className="shrink-0 border-t p-3">
        <div className="relative">
          {/* 亮点⑥ 斜杠命令面板：卡上方（"/" 唤起） */}
          {!offline && slashOpen && (
            <SlashPalette commands={slashCommands} activeIndex={slashIndex} onPick={pickSlash} onHover={setSlashIndex} />
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,.txt,.md,.csv,.json,.log,.pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => void onPickFiles(e)}
          />
          {/* 输入卡 */}
          <div
            role="group"
            aria-label="消息输入"
            data-dragging={dragging || undefined}
            onDragOver={(e) => {
              if (offline || sending) return
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault()
                setDragging(true)
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              if (offline || sending) return
              void ingestFiles([...e.dataTransfer.files])
            }}
            className={cn(
              "group relative flex flex-col rounded-2xl border bg-card transition-colors motion-reduce:transition-none",
              "focus-within:border-primary/50 focus-within:ring-[3px] focus-within:ring-ring/30 focus-within:shadow-sm",
              recording && "border-destructive/60 ring-[3px] ring-destructive/20",
              "data-[dragging=true]:border-primary data-[dragging=true]:ring-[3px] data-[dragging=true]:ring-primary/30",
            )}
          >
            {/* 拖拽覆盖层（仅 dragging 显，pointer-events-none 不挡 drop） */}
            {dragging && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/5 text-xs font-medium text-primary">
                <Paperclip className="mr-1.5 size-4" /> 松开以添加附件
              </div>
            )}

            {/* ① 附件预览 + 视觉能力提示（收进卡内顶部） */}
            {(pending.length > 0 || visionWarn) && (
              <div className="flex flex-col gap-2 px-3 pt-3">
                {pending.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <AttachmentStrip items={pending} onRemove={(i) => setPending((prev) => prev.filter((_, x) => x !== i))} />
                    <span className="self-end text-[10px] text-muted-foreground">
                      {pending.length}/{MAX_ATTACHMENTS}
                    </span>
                  </div>
                )}
                {visionWarn && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    当前模型档案不支持图片，请切换支持视觉（👁）的档案后再发送。
                  </div>
                )}
              </div>
            )}

            {/* ② 输入层（无边框融入卡；focus 视觉由卡承载） */}
            <textarea
              ref={inputRef}
              rows={1}
              value={value}
              disabled={offline || sending}
              placeholder={
                offline ? "离线模式暂不可用" : recording ? "正在聆听…（再次点击麦克风结束）" : "问问星辰助手…（/ 唤起命令 · Enter 发送 · Shift+Enter 换行）"
              }
              onChange={(e) => {
                setValue(e.target.value)
                autoGrow(e.target)
              }}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                // 粘贴含图片文件 → 进附件（走 ingestFiles 复用校验）；无图片则不拦截，正常粘贴文本
                const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"))
                if (files.length) {
                  e.preventDefault()
                  void ingestFiles(files)
                }
              }}
              className="max-h-40 min-h-[2.75rem] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />

            {/* ③ 底部工具栏：左=内容动作（附件/语音/命令） 右=模型器+圆形发送键 */}
            <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
              <div className="flex min-w-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label="添加附件（图片/文本文件）"
                  disabled={offline || sending}
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip className="size-4" />
                </Button>
                {/* 语音输入：仅浏览器支持时出现；录音态红点动画 */}
                {speechSupported && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn("relative", recording ? "text-destructive" : "text-muted-foreground")}
                    aria-label={recording ? "结束语音输入" : "语音输入"}
                    aria-pressed={recording}
                    disabled={offline || sending}
                    onClick={toggleVoice}
                  >
                    {recording ? (
                      <>
                        <Square className="size-3.5 fill-current" />
                        <span className="absolute right-0.5 top-0.5 size-1.5 animate-pulse rounded-full bg-destructive motion-reduce:animate-none" />
                      </>
                    ) : (
                      <Mic className="size-4" />
                    )}
                  </Button>
                )}
                {/* "命令"chip：再加一个斜杠唤起入口（窄屏隐藏文字保图标操作） */}
                <button
                  type="button"
                  onClick={insertSlash}
                  disabled={offline || sending}
                  className="ml-0.5 hidden items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50 sm:inline-flex"
                  aria-label="斜杠命令"
                >
                  <Slash className="size-3" /> 命令
                </button>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {/* §11 模型档案选择器（会话内记忆）：精简无边框 chip，👁 前缀=支持视觉 */}
                {!offline && models.length > 0 && (
                  <Select value={modelId ?? "default"} onValueChange={(v) => onModelChange(v === "default" ? null : v)}>
                    <SelectTrigger
                      size="sm"
                      className="h-7 max-w-[9rem] gap-1 border-none bg-transparent px-2 text-xs text-muted-foreground hover:bg-accent focus:ring-0"
                    >
                      {selectedModel?.supportsVision && <Eye className="size-3 shrink-0 text-emerald-500" aria-label="支持视觉" />}
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
                )}
                {/* 发送键：唯一实心强调，圆形主色；空态淡禁用，发送/上传中转 loading */}
                <Button
                  size="icon"
                  className="size-8 shrink-0 rounded-full"
                  disabled={(!value.trim() && pending.length === 0) || sending || offline || uploading}
                  aria-label={uploading ? "附件上传中" : sending ? "发送中" : "发送"}
                  onClick={send}
                >
                  {sending || uploading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
