import DOMPurify from "dompurify"

/**
 * 统一 HTML 净化：用户自撰的富文本/HTML 控件内容经 dangerouslySetInnerHTML 注入前，
 * 必须先经此过滤，剔除 <script>/on* 事件/javascript: 等 XSS 向量。
 *
 * 富文本编辑器输入侧无需拦截，渲染侧统一 sanitize 即可。
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return ""
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
