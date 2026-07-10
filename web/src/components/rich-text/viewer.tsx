/**
 * RichTextViewer —— 富文本 HTML 的**唯一渲染出口**（契约 §3）。
 *
 * 内部统一 sanitizeHtml（DOMPurify）+ .rt-content prose 排版（暗色两态走 token）。
 * 任何地方展示富文本 HTML 一律用它，禁止散落 dangerouslySetInnerHTML。
 * 对存量纯文本（无标签）原样呈现（sanitize 幂等）。
 */
import { cn } from "@/lib/utils"
import { sanitizeHtml } from "@/lib/sanitize"
import "./rich-text.css"

export function RichTextViewer({
  html,
  className,
}: {
  html?: string | null
  className?: string
}) {
  if (!html) return null
  return (
    <div
      className={cn("rt-content", className)}
      // eslint-disable-next-line react/no-danger — 唯一渲染出口，已经 sanitizeHtml 净化
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  )
}
