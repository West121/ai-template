/**
 * 助手面板本体（懒加载分片）：头部（对话/会话列表两态）+ 主体视图。
 * 拆出 assistant.tsx 以保持主包纤细——FormRenderer/卡片/markdown 只在首次打开面板时加载。
 *
 * 高级抽屉能力（桌面态）：
 *  - 左缘拖拽调宽（Pointer 事件，clamp [360, min(960, 92vw)]，持久化 localStorage）。
 *  - 全屏切换（Maximize/Minimize，覆盖整个视口；全屏时隐藏拖拽把手）。
 *  - 面板全链路 min-w-0：宽内容（md 表格/代码块/list/图表）各自容器内横滚，面板本身不出横向滚动条。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, History, Maximize2, Minimize2, Sparkles, SquarePen, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ChatView } from "./chat-view"
import { SessionListView } from "./session-list"
import type { AiAttachment, AiMessage, AiModelOption, AiSession } from "./types"
import "./ai-chat.css"

const WIDTH_KEY = "ai-panel-width"
const MIN_W = 360
const maxW = () => Math.min(960, Math.round(window.innerWidth * 0.92))
const clampW = (w: number) => Math.max(MIN_W, Math.min(maxW(), w))

function initialWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(saved) && saved >= MIN_W) return clampW(saved)
  } catch {
    /* SSR/隐私模式忽略 */
  }
  return 420
}

export interface AssistantPanelProps {
  view: "chat" | "sessions"
  demo: boolean
  offline: boolean
  headerTitle: string | null
  messages: AiMessage[]
  sessions: AiSession[]
  activeSessionId?: string
  sending: boolean
  /** null=无错误；有值=失败文案（空串走默认文案） */
  sendError: string | null
  /** §11 模型切换 */
  models: AiModelOption[]
  modelId: number | null
  onModelChange: (id: number | null) => void
  focusSignal: number
  onSend: (text: string, attachments: AiAttachment[]) => void
  onRetry: () => void
  onNewSession: () => void
  onOpenSessionList: () => void
  onOpenSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onBackToChat: () => void
  onClose: () => void
}

export default function AssistantPanel(p: AssistantPanelProps) {
  const [width, setWidth] = useState<number>(initialWidth)
  const [fullscreen, setFullscreen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width

  /* ---- 左缘拖拽调宽（桌面态；全屏时把手隐藏） ---- */
  const onResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setResizing(true)
    const move = (ev: PointerEvent) => {
      // 面板贴右缘：宽度 = 视口宽 - 指针 x
      setWidth(clampW(Math.round(window.innerWidth - ev.clientX)))
    }
    const up = () => {
      setResizing(false)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      try {
        localStorage.setItem(WIDTH_KEY, String(widthRef.current))
      } catch {
        /* 忽略 */
      }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }, [])

  // 视口缩小时收敛宽度，避免面板超宽出横滚
  useEffect(() => {
    const onResize = () => setWidth((w) => clampW(w))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  return (
    <div
      role="dialog"
      aria-label="星辰智能助手"
      aria-modal={false}
      style={{ ["--ai-panel-w" as never]: `${width}px` }}
      className={cn(
        "fixed z-40 grid min-w-0 grid-rows-[auto_1fr_auto] bg-background",
        "animate-in duration-300 slide-in-from-right fade-in-0 motion-reduce:animate-none",
        // 桌面：右侧非模态（无遮罩不锁 body，navigate 后面板保持开）；宽度受控（拖拽/持久化）
        !fullscreen && "sm:inset-y-0 sm:right-0 sm:w-[var(--ai-panel-w)] sm:max-w-[92vw] sm:border-l sm:shadow-2xl",
        // 桌面全屏：覆盖整个视口
        fullscreen && "sm:inset-0 sm:w-auto sm:border-l-0 sm:shadow-2xl",
        // 拖拽中禁用过渡/选中，保证跟手
        resizing && "select-none",
        // 移动：模态全屏
        "max-sm:inset-0 max-sm:z-50 max-sm:w-full",
      )}
    >
      {/* 拖拽把手（仅桌面非全屏；命中区 8px，视觉 1px 高亮条） */}
      {!fullscreen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整面板宽度"
          onPointerDown={onResizeStart}
          className={cn(
            "absolute inset-y-0 left-0 z-10 hidden w-2 cursor-col-resize sm:block",
            "after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-transparent after:transition-colors",
            "hover:after:bg-primary/50",
            resizing && "after:bg-primary",
          )}
        />
      )}

      <header className="flex h-14 min-w-0 shrink-0 items-center gap-2 border-b px-3">
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
            <Button
              variant="ghost"
              size="icon-sm"
              className="max-sm:hidden"
              aria-label={fullscreen ? "退出全屏" : "全屏"}
              onClick={() => setFullscreen((f) => !f)}
            >
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
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
          models={p.models}
          modelId={p.modelId}
          onModelChange={p.onModelChange}
          onSend={p.onSend}
          onRetry={p.onRetry}
          focusSignal={p.focusSignal}
        />
      )}
    </div>
  )
}
