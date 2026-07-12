/**
 * 正文编解码：知识库后端存 TipTap JSON（contentJson，原样不解析），前端复用 rich-text（HTML 编辑器）。
 * 这里用 @tiptap/core 的 generateHTML/generateJSON + 与编辑器同一套扩展（standard 预设）做互转，
 * 编辑器组件本身零改动。全部 try/catch 兜底（防白屏）：转换失败回退空文档，绝不抛。
 * 扩展惰性构建（避免模块加载期副作用；转换本身需 DOM，仅在浏览器/jsdom 调用）。
 */
import { generateHTML, generateJSON, type Extensions } from "@tiptap/core"
import { buildExtensions, resolveFeatures } from "@/components/rich-text"

let cached: Extensions | null = null
function exts(): Extensions {
  if (!cached) cached = buildExtensions(resolveFeatures("standard"), {}) as Extensions
  return cached
}

const EMPTY_DOC = { type: "doc", content: [] }

/** TipTap JSON → 编辑器 HTML（空/非法 → ""） */
export function jsonToHtml(json: unknown): string {
  if (!json || typeof json !== "object") return ""
  try {
    return generateHTML(json as Record<string, unknown>, exts())
  } catch {
    return ""
  }
}

/** 编辑器 HTML → TipTap JSON（空/失败 → 空 doc） */
export function htmlToJson(html: string): unknown {
  const h = html && html.trim() ? html : ""
  if (!h) return EMPTY_DOC
  try {
    return generateJSON(h, exts())
  } catch {
    return EMPTY_DOC
  }
}
