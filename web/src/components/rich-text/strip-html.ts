/**
 * HTML → 纯文本摘要 / 空文档判定（纯函数，node 可测）。
 *
 * - `stripHtml(html, maxLen?)`：列表列、通知/消息摘要、日志用。块级闭合与 <br> 折为空格，
 *   剥标签、解常用实体、折叠空白；超长截断加省略号。对纯文本输入原样（幂等）。
 * - `isEmptyHtml(html)`：空文档归一判定——`<p></p>`/`<p><br></p>`/空白皆视为空，
 *   防止「意见必填」被空 HTML 骗过（契约 §4）。含图片/表格等内容元素时不算空。
 */

const BLOCK_CLOSE_RE = /<\/(p|div|li|tr|h[1-6]|blockquote|th|td)>/gi
const BR_RE = /<br\s*\/?>/gi
const TAG_RE = /<[^>]+>/g

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&") // 最后解 &amp;，避免二次解码
}

/** HTML → 单行纯文本摘要；maxLen 超长截断加 "…" */
export function stripHtml(html: string | null | undefined, maxLen?: number): string {
  if (!html) return ""
  const text = decodeEntities(
    html.replace(BR_RE, " ").replace(BLOCK_CLOSE_RE, " ").replace(TAG_RE, ""),
  )
    .replace(/\s+/g, " ")
    .trim()
  if (maxLen != null && maxLen > 0 && text.length > maxLen) {
    return `${text.slice(0, maxLen)}…`
  }
  return text
}

/** 含实义内容的自闭合/媒体元素：即便无文字也不算空文档 */
const CONTENT_ELEMENT_RE = /<(img|table|hr|iframe|video|audio)\b/i

/** 空文档判定：无文字且无内容元素（`<p></p>`、`<p><br></p>`、纯空白 → true） */
export function isEmptyHtml(html: string | null | undefined): boolean {
  if (!html) return true
  if (CONTENT_ELEMENT_RE.test(html)) return false
  return stripHtml(html) === ""
}

/** 提交前归一：空 HTML → ""（配合「必填」校验；非空原样返回） */
export function normalizeRichText(html: string | null | undefined): string {
  return isEmptyHtml(html) ? "" : (html as string)
}
