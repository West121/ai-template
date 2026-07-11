/**
 * AI 智能助手 · 前后端对话协议类型（docs/design/ai-assistant-design.md §3/§10）。
 * 纯类型，无运行时依赖。
 */
import type { FormWidget } from "@/types/workflow"

/* ============================ 六类卡片 ============================ */

export interface AiNavigateCard {
  type: "navigate"
  /** 路径已由后端校验在用户可见菜单内 */
  path: string
  title: string
  desc?: string
}

export interface AiConfirmCard {
  type: "confirm"
  /** 服务端持久化的待确认动作 id（V2：ai_action_draft，过期/幂等/乐观锁在服务端） */
  actionId: string
  title: string
  summary?: string
  /** 参数摘要（label/value 展示；执行参数以服务端草稿为准） */
  params?: { label: string; value: string }[]
  /** 危险操作（删除/驳回等）红色语义（§10） */
  danger?: boolean
  /** V2：过期时间（展示） */
  expiresAt?: string
}

export interface AiFormCard {
  type: "form"
  defCode: string
  defName: string
  formType?: string
  /** 在线表单 widgets（有则内嵌 FormRenderer） */
  schema?: FormWidget[]
  /** CODE 表单发起页路由（无 schema 时跳转按钮，§10） */
  submitPath?: string
}

export interface AiListRow {
  [key: string]: unknown
  /** 行级跳转（§10） */
  link?: string
}

export interface AiListCard {
  type: "list"
  title: string
  columns: { key: string; label: string }[]
  rows: AiListRow[]
  moreLink?: string
}

export interface AiChartSeries {
  name: string
  data: number[]
  /** pie 数据项占比展示（§10，由后端算） */
  percent?: number
}

export interface AiChartCard {
  type: "chart"
  chartType: "bar" | "line" | "pie"
  title: string
  categories?: string[]
  series: AiChartSeries[]
}

export interface AiLinkCard {
  type: "link"
  items: { title: string; path: string }[]
}

export type AiCard =
  | AiNavigateCard
  | AiConfirmCard
  | AiFormCard
  | AiListCard
  | AiChartCard
  | AiLinkCard

/* ============================ 附件 / 模型（§11 增强批） ============================ */

/** 多模态附件：小图/文本直接 dataURL（或走 /api/infra/files 得 fileId，磐石定） */
export interface AiAttachment {
  kind: "IMAGE" | "TEXT"
  name: string
  dataUrl?: string
  fileId?: number
  /** 字节数（chip 展示） */
  size?: number
}

/** GET /api/ai/models 可选凭据（启用的 LLM 型；V2 由 model-profiles 替代，保留兼容回退） */
export interface AiModelOption {
  credentialId: number
  name: string
  model: string
  /** 支持视觉（图片理解）；选择器加 👁 徽标 */
  supportsVision?: boolean
}

/** V2 模型档案（§4.3：用户只选档案 FAST/STANDARD/REASONING/VISION，真实凭据不出 API） */
export interface AiModelProfile {
  id: string
  name: string
  description?: string
  supportsVision?: boolean
}

/** 选择器统一条目：V2 档案，或 model-profiles 404 时映射的旧凭据（legacyCredentialId 存在 = 旧协议发送 credentialId/model） */
export interface AiModelChoice extends AiModelProfile {
  legacyCredentialId?: number
  legacyModel?: string
}

/* ============================ 消息 / 会话 ============================ */

export interface AiMessage {
  role: "USER" | "ASSISTANT"
  /** 助手消息为 markdown；用户消息按纯文本渲染（不套 .ai-md，防注入+反白） */
  content: string
  /** 旧协议卡片（历史消息兼容读；有 parts 时优先 parts） */
  cards?: AiCard[]
  /** V2 消息 Part（§9.3：partId/partType/schemaVersion/payload/sequenceNo，兼容并存） */
  parts?: AiMessagePartRef[]
  /** 随消息附带的附件（用户气泡回显） */
  attachments?: AiAttachment[]
  /** 前端生成 ULID（重试幂等，§9.1 clientMessageId） */
  clientMessageId?: string
  createdAt?: string
}

/** 结构同 protocol.AiMessagePart（此处内联避免循环依赖：types 保持无运行时依赖） */
export interface AiMessagePartRef {
  partId: string
  partType: string
  schemaVersion: number
  payload: Record<string, unknown>
  sequenceNo: number
}

export interface AiSession {
  id: string
  /** 首问自动摘要 */
  title: string
  updatedAt: string
}

/** POST /api/ai/chat 响应 */
export interface AiChatResponse {
  sessionId: string
  messages: AiMessage[]
}

/** POST /api/ai/confirm 响应 */
export interface AiConfirmResponse {
  ok: boolean
  /** 执行结果文案（成功条展示） */
  message?: string
  /** 结果链接（如实例详情） */
  resultLink?: string
  /** 过期/失效标记（前端转 expired 态） */
  expired?: boolean
}
