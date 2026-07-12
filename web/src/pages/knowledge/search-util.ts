/**
 * 检索片段 纯函数（可单测）：在命中处取上下文窗口，转义 HTML 后用 <mark> 包裹关键词。
 * 后端真实 snippet 已含 <mark>；本函数供 mock 生成同形状片段，也可复用。绝不抛。
 */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** 生成含 <mark> 的高亮片段；无命中则取开头一段。radius=前后保留字符数。 */
export function buildSnippet(text: string, q: string, radius = 40): string {
  const src = typeof text === "string" ? text : ""
  if (!src) return ""
  const query = (q ?? "").trim()
  const idx = query ? src.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (idx < 0) {
    const head = src.slice(0, radius * 2)
    return esc(head) + (src.length > head.length ? "…" : "")
  }
  const start = Math.max(0, idx - radius)
  const end = Math.min(src.length, idx + query.length + radius)
  const before = (start > 0 ? "…" : "") + esc(src.slice(start, idx))
  const mark = `<mark>${esc(src.slice(idx, idx + query.length))}</mark>`
  const after = esc(src.slice(idx + query.length, end)) + (end < src.length ? "…" : "")
  return before + mark + after
}
