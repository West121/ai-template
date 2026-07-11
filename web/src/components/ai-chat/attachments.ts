/**
 * 多模态附件（ai-assistant-design.md §11）：类型/大小校验纯函数 + 视觉能力检测。
 * 图片 png/jpg/webp ≤5MB；文本类 txt/md/csv/json/log ≤1MB；pdf/docx 本批不支持（就地提示）。
 */
import type { AiAttachment } from "./types"

export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const
export const TEXT_EXTS = ["txt", "md", "csv", "json", "log"] as const
/** 本批明确不支持（给专门文案，区别于未知类型） */
const OFFICE_EXTS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const TEXT_MAX_BYTES = 1 * 1024 * 1024
/** 单条消息附件上限 */
export const MAX_ATTACHMENTS = 4

export type AttachmentCheck = { ok: true; kind: "IMAGE" | "TEXT" } | { ok: false; reason: string }

export function extOf(name: string): string {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ""
}

/** 文件准入校验（纯函数，选择文件时就地把关） */
export function checkAttachmentFile(name: string, mime: string, size: number): AttachmentCheck {
  if ((IMAGE_MIMES as readonly string[]).includes(mime)) {
    if (size > IMAGE_MAX_BYTES) {
      return { ok: false, reason: `图片「${name}」超过 5MB 限制（${formatBytes(size)}）` }
    }
    return { ok: true, kind: "IMAGE" }
  }
  const ext = extOf(name)
  if (OFFICE_EXTS.includes(ext)) {
    return { ok: false, reason: `暂不支持 ${ext.toUpperCase()} 文档解析（本批仅图片与纯文本，PDF/Office 后续版本支持）` }
  }
  if ((TEXT_EXTS as readonly string[]).includes(ext)) {
    if (size > TEXT_MAX_BYTES) {
      return { ok: false, reason: `文本文件「${name}」超过 1MB 限制（${formatBytes(size)}）` }
    }
    return { ok: true, kind: "TEXT" }
  }
  return { ok: false, reason: `不支持的文件类型「${ext || mime || "未知"}」（图片 png/jpg/webp 或文本 txt/md/csv/json/log）` }
}

/** 带图片但所选模型档案不支持视觉 → true（就地提示引导切换；未知/默认档案交给后端 400 文案） */
export function needsVisionWarning(attachments: Pick<AiAttachment, "kind">[], model: { supportsVision?: boolean } | null | undefined): boolean {
  if (!attachments.some((a) => a.kind === "IMAGE")) return false
  if (!model) return false
  return !model.supportsVision
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
}

/* ============================ 批D：fileId 化上传态 + 发送载荷归一 ============================ */

/** 输入区预览用的附件（含上传态）：uploading→上传中；done→已得 attachmentId；error→回退 dataUrl 兼容 */
export interface PendingAttachment extends AiAttachment {
  /** 本地唯一 id（预览列表 key / 上传结果回填定位） */
  localId: string
  uploadState: "uploading" | "done" | "error"
  /** 上传进度 0..100（uploading 态展示） */
  progress?: number
}

/** 仍有附件在上传中 → 阻止发送（避免发出未就绪 attachmentId；错误态已回退 dataUrl 可发） */
export function hasUploadingAttachment(items: Pick<PendingAttachment, "uploadState">[]): boolean {
  return items.some((a) => a.uploadState === "uploading")
}

/** POST /api/ai/attachments 成功响应（磐石批D 契约：{attachmentId,kind,name,url}） */
export interface AttachmentUploadResult {
  attachmentId: string
  kind: "IMAGE" | "TEXT"
  name: string
  url?: string
}

/** 聊天消息里的附件载荷（wire）：fileId 化后仅 attachmentId+kind+name；未就绪回退 dataUrl */
export interface AiAttachmentWire {
  kind: "IMAGE" | "TEXT"
  name: string
  attachmentId?: string
  dataUrl?: string
  fileId?: number
}

/**
 * 附件 → 发送载荷（§17.1）：已上传优先 attachmentId（不再塞大图 dataUrl 进消息表）；
 * 未上传（兼容期/上传失败）回退 dataUrl；旧 fileId 一并透传。
 */
export function toWireAttachment(a: AiAttachment): AiAttachmentWire {
  const w: AiAttachmentWire = { kind: a.kind, name: a.name }
  if (a.attachmentId) w.attachmentId = a.attachmentId
  else if (a.dataUrl) w.dataUrl = a.dataUrl
  if (a.fileId != null) w.fileId = a.fileId
  return w
}

/** 图片回显地址：优先服务端 url，回退本地 dataUrl（fileId 化后仍可无 dataUrl） */
export function imageSrcOf(a: Pick<AiAttachment, "url" | "dataUrl">): string | undefined {
  return a.url ?? a.dataUrl
}
