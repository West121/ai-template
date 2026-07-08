import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Maximize2, Minimize2, X } from "lucide-react"
import { cn } from "@/lib/utils"

const VIEWPORT_MARGIN = 48

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** 底部操作区，缺省不渲染 footer */
  footer?: ReactNode
  /** 弹出方向，默认右侧 */
  side?: "left" | "right"
  /** 初始宽度 px，默认 480 */
  width?: number
  minWidth?: number
  /** 拖拽内缘拖动改变宽度（全屏时自动禁用），默认开启 */
  resizable?: boolean
  /** 全屏切换（双击标题栏也可切换），默认开启 */
  fullscreenable?: boolean
  /** 点击遮罩关闭，默认 true */
  maskClosable?: boolean
  className?: string
  /** 内容区（滚动容器）自定义样式 */
  bodyClassName?: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "right",
  width = 480,
  minWidth = 320,
  resizable = true,
  fullscreenable = true,
  maskClosable = true,
  className,
  bodyClassName,
}: DrawerProps) {
  const [fullscreen, setFullscreen] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  /** 实时宽度。拖拽期间直接写 DOM，不触发 React 渲染 */
  const widthRef = useRef(width)
  const dragStart = useRef<{ px: number; bw: number } | null>(null)

  const applyWidth = useCallback((el: HTMLDivElement, fs: boolean) => {
    el.style.width = fs ? "100vw" : `${widthRef.current}px`
    el.style.maxWidth = fs ? "100vw" : `calc(100vw - ${VIEWPORT_MARGIN}px)`
  }, [])

  // 每次打开重置宽度与全屏状态
  useEffect(() => {
    if (open) {
      widthRef.current = width
      setFullscreen(false)
    }
  }, [open, width])

  // 全屏切换：宽度过渡产生动画
  useEffect(() => {
    const el = contentRef.current
    if (el) applyWidth(el, fullscreen)
  }, [fullscreen, applyWidth])

  const toggleFullscreen = useCallback(() => {
    if (fullscreenable) setFullscreen((f) => !f)
  }, [fullscreenable])

  /* ---------- 拖拽内缘改变宽度 ---------- */
  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = contentRef.current
    if (!el || fullscreen) return
    dragStart.current = { px: e.clientX, bw: el.getBoundingClientRect().width }
    el.style.transitionProperty = "none"
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    const el = contentRef.current
    if (!start || !el) return
    const delta = side === "right" ? start.px - e.clientX : e.clientX - start.px
    widthRef.current = clamp(
      start.bw + delta,
      minWidth,
      window.innerWidth - VIEWPORT_MARGIN,
    )
    el.style.width = `${widthRef.current}px`
  }

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return
    dragStart.current = null
    if (contentRef.current) contentRef.current.style.transitionProperty = ""
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          ref={(el) => {
            contentRef.current = el
            if (el) applyWidth(el, fullscreen)
          }}
          {...(description ? {} : { "aria-describedby": undefined })}
          onInteractOutside={maskClosable ? undefined : (e) => e.preventDefault()}
          className={cn(
            "fixed inset-y-0 z-50 flex flex-col border-border bg-background shadow-xl outline-none",
            "transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-300 data-[state=closed]:duration-200",
            side === "right"
              ? "right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
              : "left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
            fullscreen && "border-transparent",
            className,
          )}
        >
          {/* 标题栏 */}
          <div
            onDoubleClick={fullscreenable ? toggleFullscreen : undefined}
            className="flex shrink-0 select-none items-start gap-1 border-b px-5 py-3.5"
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
                aria-label={fullscreen ? "退出全屏" : "全屏"}
              >
                {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
            )}
            <DialogPrimitive.Close
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label="关闭"
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

          {/* 宽度拖拽手柄（内缘） */}
          {resizable && !fullscreen && (
            <div
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              className={cn(
                "group absolute inset-y-0 z-10 flex w-2 cursor-ew-resize touch-none items-center justify-center",
                side === "right" ? "-left-1" : "-right-1",
              )}
            >
              <div className="h-8 w-1 rounded-full bg-border transition-colors group-hover:bg-primary/60" />
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
