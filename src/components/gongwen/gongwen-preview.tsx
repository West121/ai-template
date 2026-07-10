/**
 * 红头正文预览（GB/T 9704）。
 *
 * 主控裁定：红头正文 HTML 由后端 `POST /api/office/doc/{id}/render` 返回（`.gw-*` class 的
 * `.gw-typearea` 内部 HTML 片段）；前端只提供 `.gongwen-paper > .gw-page > .gw-typearea` 外壳
 * 和 gongwen.css 那套固定白底版式。后端未就绪时 renderDoc() 落到 mock，产出同结构 HTML，
 * 接口切换零改版。
 *
 * 预览区窄时用 transform: scale() 整体缩放 .gw-page（保持 mm 尺寸不变，仅视觉缩放）。
 * 打印/PDF 走 window.print()，gongwen.css 的 @media print 隔离 .gongwen-paper。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Printer, RotateCw } from "lucide-react"
import { sanitizeHtml } from "@/lib/sanitize"
import { renderDoc } from "@/pages/document/gongwen/mock"
import type { GwDoc } from "@/pages/document/gongwen/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import "./gongwen.css"

/** A4 纸宽 210mm ≈ 794px（96dpi），用于 scale-to-fit 计算 */
const PAPER_PX = 794

export function printGongwen() {
  window.print()
}

export function GongwenPreview({
  doc,
  className,
  showToolbar = true,
}: {
  doc: GwDoc
  className?: string
  showToolbar?: boolean
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const shellRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await renderDoc(doc)
      setHtml(sanitizeHtml(data))
    } catch {
      setHtml(null)
    } finally {
      setLoading(false)
    }
  }, [doc])

  useEffect(() => {
    void load()
  }, [load])

  // scale-to-fit：容器窄于纸宽时按比例缩放（含内边距余量）
  useLayoutEffect(() => {
    const el = shellRef.current
    if (!el) return
    const compute = () => {
      const avail = el.clientWidth - 32
      setScale(avail >= PAPER_PX ? 1 : Math.max(0.4, avail / PAPER_PX))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className={cn("flex flex-col", className)}>
      {showToolbar && (
        <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-2">
          <span className="text-xs text-muted-foreground">红头正文预览 · GB/T 9704</span>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" onClick={() => void load()}>
              <RotateCw className="size-3.5" /> 刷新
            </Button>
            <Button size="sm" className="h-7 gap-1.5 px-2.5" onClick={printGongwen}>
              <Printer className="size-3.5" /> 打印 / PDF
            </Button>
          </div>
        </div>
      )}
      <div ref={shellRef} className="gw-preview-shell min-h-0 flex-1">
        {loading ? (
          <div className="p-6">
            <Skeleton className="mx-auto h-[600px] w-full max-w-[794px]" />
          </div>
        ) : html == null ? (
          <div className="flex h-full items-center justify-center py-16 text-sm text-muted-foreground">
            预览渲染失败
          </div>
        ) : (
          <div className="gongwen-paper">
            {/* render HTML 已含 .gw-typearea 包裹（后端 GongwenRenderer 与 mock 一致），此处只套 .gw-page 外壳 */}
            <div
              className={cn("gw-page", scale < 1 && "gw-page--scaled")}
              style={scale < 1 ? { transform: `scale(${scale})`, marginBottom: `${(scale - 1) * 1122}px` } : undefined}
              // eslint-disable-next-line react/no-danger — HTML 已经 sanitizeHtml 净化
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
