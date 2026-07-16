import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Maximize2, Minimize2, X } from "lucide-react"
import { cn } from "@/lib/utils"

const VIEWPORT_MARGIN = 16
/** 与 transition-[…] duration 保持一致 */
const TRANSITION_MS = 300

type ResizeDir = "e" | "s" | "se"

export interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** 底部操作区，缺省不渲染 footer */
  footer?: ReactNode
  /** 初始宽度 px，默认 640 */
  width?: number
  /** 初始高度 px，缺省按内容自适应 */
  height?: number
  minWidth?: number
  minHeight?: number
  /** 按住标题栏拖拽移动（全屏时自动禁用），默认开启 */
  draggable?: boolean
  /** 右缘/下缘/右下角伸缩，默认开启 */
  resizable?: boolean
  /** 标题栏全屏切换按钮（双击标题栏也可切换），默认开启 */
  fullscreenable?: boolean
  /** 点击遮罩关闭，默认 true */
  maskClosable?: boolean
  /**
   * 打开时自动聚焦弹窗内首个可聚焦元素（Radix 默认行为），默认 true。
   * 内嵌 CodeMirror 等富编辑器时传 false：阻止 Radix FocusScope 的挂载抢焦点，
   * 否则焦点被夺走/来回争抢会导致编辑器无法输入（打字、方向键失效）。
   */
  autoFocus?: boolean
  className?: string
  /** 内容区（滚动容器）自定义样式 */
  bodyClassName?: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 640,
  height,
  minWidth = 360,
  minHeight = 160,
  draggable = true,
  resizable = true,
  fullscreenable = true,
  maskClosable = true,
  autoFocus = true,
  className,
  bodyClassName,
}: ModalProps) {
  const { t } = useTranslation()
  const [fullscreen, setFullscreen] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  /** 位置偏移与尺寸的实时值。拖拽/伸缩期间直接写 DOM，不触发 React 渲染，保证丝滑 */
  const geo = useRef<{ x: number; y: number; w: number; h: number | null }>({
    x: 0,
    y: 0,
    w: width,
    h: height ?? null,
  })
  /** 进入全屏前的实际渲染尺寸，退出时用于过渡动画 */
  const savedRect = useRef<{ w: number; h: number } | null>(null)
  const dragStart = useRef<{ px: number; py: number; bx: number; by: number } | null>(null)
  const resizeStart = useRef<{
    dir: ResizeDir
    px: number
    py: number
    bw: number
    bh: number
    bx: number
    by: number
  } | null>(null)

  const applyGeometry = useCallback((el: HTMLDivElement, fs: boolean) => {
    if (fs) {
      el.style.width = "100vw"
      el.style.height = "100dvh"
      el.style.maxWidth = "100vw"
      el.style.maxHeight = "100dvh"
      el.style.transform = "translate(-50%, -50%)"
    } else {
      const g = geo.current
      el.style.width = `${g.w}px`
      el.style.height = g.h == null ? "" : `${g.h}px`
      el.style.maxWidth = `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`
      el.style.maxHeight = `calc(100dvh - ${VIEWPORT_MARGIN * 2}px)`
      el.style.transform = `translate(-50%, -50%) translate(${g.x}px, ${g.y}px)`
    }
  }, [])

  /** 约束位置：弹窗横向至少留 100px 在视口内，标题栏纵向始终可见，保证永远拖得回来 */
  const clampPosition = useCallback((el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const halfGapX = (vw - rect.width) / 2
    const halfGapY = (vh - rect.height) / 2
    const g = geo.current
    g.x = clamp(g.x, -halfGapX - rect.width + 100, halfGapX + rect.width - 100)
    g.y = clamp(g.y, -halfGapY, halfGapY + rect.height - 48)
  }, [])

  // 每次打开重置位置、尺寸与全屏状态
  useEffect(() => {
    if (open) {
      geo.current = { x: 0, y: 0, w: width, h: height ?? null }
      savedRect.current = null
      setFullscreen(false)
    }
  }, [open, width, height])

  // 浏览器窗口尺寸变化后重新夹取位置，防止弹窗被留在视口外
  useEffect(() => {
    const onWindowResize = () => {
      const el = contentRef.current
      if (!el || fullscreen) return
      clampPosition(el)
      applyGeometry(el, false)
    }
    window.addEventListener("resize", onWindowResize)
    return () => window.removeEventListener("resize", onWindowResize)
  }, [fullscreen, clampPosition, applyGeometry])

  // 全屏切换时应用几何属性（CSS transition 产生动画）
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    applyGeometry(el, fullscreen)
    if (!fullscreen && savedRect.current) {
      // 退出全屏：先过渡回原有 px 尺寸，动画结束后高度恢复自适应
      const saved = savedRect.current
      el.style.width = `${saved.w}px`
      el.style.height = `${saved.h}px`
      const timer = setTimeout(() => {
        savedRect.current = null
        applyGeometry(el, false)
      }, TRANSITION_MS + 20)
      return () => clearTimeout(timer)
    }
  }, [fullscreen, applyGeometry])

  const toggleFullscreen = useCallback(() => {
    if (!fullscreenable) return
    const el = contentRef.current
    if (!el) return
    if (!fullscreen) {
      // 高度可能是 auto，先固定为当前实际值，宽高过渡动画才能生效
      const rect = el.getBoundingClientRect()
      savedRect.current = { w: rect.width, h: rect.height }
      el.style.width = `${rect.width}px`
      el.style.height = `${rect.height}px`
      void el.offsetHeight // 强制 reflow，确保过渡起点生效
      setFullscreen(true)
    } else {
      setFullscreen(false)
    }
  }, [fullscreen, fullscreenable])

  /* ---------- 拖拽移动 ---------- */
  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable || fullscreen) return
    if ((e.target as HTMLElement).closest("button")) return
    const el = contentRef.current
    if (!el) return
    dragStart.current = { px: e.clientX, py: e.clientY, bx: geo.current.x, by: geo.current.y }
    el.style.transitionProperty = "none"
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    const el = contentRef.current
    if (!start || !el) return
    geo.current.x = start.bx + e.clientX - start.px
    geo.current.y = start.by + e.clientY - start.py
    clampPosition(el)
    el.style.transform = `translate(-50%, -50%) translate(${geo.current.x}px, ${geo.current.y}px)`
  }

  const onHeaderPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return
    dragStart.current = null
    if (contentRef.current) contentRef.current.style.transitionProperty = ""
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  /* ---------- 伸缩 ---------- */
  const onResizePointerDown = (dir: ResizeDir) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = contentRef.current
    if (!el || fullscreen) return
    const rect = el.getBoundingClientRect()
    // 高度自适应时转为固定值，之后可自由伸缩
    geo.current.w = rect.width
    if (geo.current.h == null) geo.current.h = rect.height
    resizeStart.current = {
      dir,
      px: e.clientX,
      py: e.clientY,
      bw: rect.width,
      bh: rect.height,
      bx: geo.current.x,
      by: geo.current.y,
    }
    el.style.transitionProperty = "none"
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current
    const el = contentRef.current
    if (!start || !el) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (start.dir === "e" || start.dir === "se") {
      const w = clamp(start.bw + (e.clientX - start.px), minWidth, vw - VIEWPORT_MARGIN * 2)
      // 弹窗以中心定位，宽度变化补偿一半偏移，让左缘保持不动
      geo.current.w = w
      geo.current.x = start.bx + (w - start.bw) / 2
    }
    if (start.dir === "s" || start.dir === "se") {
      const h = clamp(start.bh + (e.clientY - start.py), minHeight, vh - VIEWPORT_MARGIN * 2)
      geo.current.h = h
      geo.current.y = start.by + (h - start.bh) / 2
    }
    clampPosition(el)
    applyGeometry(el, false)
  }

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return
    resizeStart.current = null
    if (contentRef.current) contentRef.current.style.transitionProperty = ""
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const resizeHandleProps = (dir: ResizeDir) => ({
    onPointerDown: onResizePointerDown(dir),
    onPointerMove: onResizePointerMove,
    onPointerUp: onResizePointerUp,
  })

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          ref={(el) => {
            contentRef.current = el
            if (el) applyGeometry(el, fullscreen)
          }}
          {...(description ? {} : { "aria-describedby": undefined })}
          onInteractOutside={maskClosable ? undefined : (e) => e.preventDefault()}
          onOpenAutoFocus={autoFocus ? undefined : (e) => e.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex flex-col overflow-hidden border bg-background shadow-xl outline-none",
            "transition-[width,height,transform,border-radius] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
            fullscreen ? "rounded-none border-transparent" : "rounded-xl",
            className,
          )}
        >
          {/* 标题栏：拖拽手柄 + 全屏/关闭按钮 */}
          <div
            onPointerDown={onHeaderPointerDown}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={onHeaderPointerUp}
            onDoubleClick={fullscreenable ? toggleFullscreen : undefined}
            className={cn(
              "flex shrink-0 select-none items-start gap-1 border-b px-5 py-3.5",
              draggable && !fullscreen && "cursor-move touch-none",
            )}
          >
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-base font-semibold leading-6">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            {fullscreenable && (
              <button
                type="button"
                onClick={toggleFullscreen}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label={fullscreen ? t("退出全屏") : t("全屏")}
              >
                {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
            )}
            <DialogPrimitive.Close
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label={t("关闭")}
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          {/* 内容区：@container 容器，内容可用 @sm/@md/@lg 等容器查询断点做响应式 */}
          <div className={cn("@container min-h-0 flex-1 overflow-y-auto px-5 py-4", bodyClassName)}>
            {children}
          </div>

          {/* 底部操作区 */}
          {footer && (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
              {footer}
            </div>
          )}

          {/* 伸缩手柄：右缘 / 下缘 / 右下角 */}
          {resizable && !fullscreen && (
            <>
              <div
                {...resizeHandleProps("e")}
                className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize touch-none"
              />
              <div
                {...resizeHandleProps("s")}
                className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize touch-none"
              />
              <div
                {...resizeHandleProps("se")}
                className="absolute bottom-0 right-0 flex size-4 cursor-nwse-resize touch-none items-end justify-end p-0.5 text-muted-foreground/50"
              >
                <svg viewBox="0 0 8 8" className="size-2.5" fill="none" stroke="currentColor">
                  <path d="M7 1L1 7M7 4.5L4.5 7" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
