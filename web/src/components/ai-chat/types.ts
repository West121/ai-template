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

/** 批E 亮点⑨ 审批 AI 摘要：3 行摘要 + 风险点（红/黄标签）。"AI 生成仅供参考" */
export interface AiRisk {
  /** HIGH→红 / MEDIUM→黄 / 其它→中性（也容忍中文"高/中"） */
  level?: "HIGH" | "MEDIUM" | "LOW" | (string & {})
  text: string
}
export interface AiSummary {
  summary: string
  risks?: AiRisk[]
}

/** 批E 亮点⑩ 流程预测链：通过后流转（步骤名 + 预计办理人） */
export interface AiPredictStep {
  stepName: string
  assigneeName?: string
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
  /** 批E⑨ 审批 AI 摘要（有则在参数区上方展示） */
  aiSummary?: AiSummary
  /** 批E⑩ 通过后流转预测链（有则在确认键上方展示） */
  predictChain?: AiPredictStep[]
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
  /**
   * 预填值 {fieldKey: value}（后端从用户话语提取 knownValues→prefill，如"请10天年假"→
   * {leaveType:"年假", days:10}）；透传给 FormRenderer initialValues，用户只需补余下字段。
   */
  prefill?: Record<string, unknown>
}

export interface AiListRow {
  [key: string]: unknown
  /** 行级跳转（§10） */
  link?: string
  /** 批E⑨ 该待办项的 AI 摘要 + 风险点（有则行内展示） */
  aiSummary?: AiSummary
}

export interface AiListCard {
  type: "list"
  title: string
  columns: { key: string; label: string }[]
  rows: AiListRow[]
  moreLink?: string
  /** V2 §10.4：受控导航"查看全部"（featureCode 走 Registry） */
  moreFeatureCode?: string
  /** V2 批C：数据集分页（有值时卡内分页，GET /api/ai/datasets/{id}?pageNum=） */
  datasetId?: string
  page?: { current: number; size: number; total: number }
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
  /** V2 批C 下钻：点击 bar 类目 / pie 扇区 → report_execute({[paramName]: 类目}) → 追加 list 卡 */
  drill?: { reportCode: string; paramName: string }
}

export interface AiLinkCard {
  type: "link"
  items: { title: string; path: string }[]
}

/* ---------------- 批E 平台联动草稿卡（⑦⑧，永不直接发布，去设计器继续编辑） ---------------- */

/** ⑦ 编排草稿卡：自然语言 → OrchModel 草稿（CRON/事件触发 + 报表/通知节点），确认后建 DRAFT 流并跳设计器 */
export interface AiFlowDraftCard {
  type: "flowDraft"
  draftId: string
  name: string
  /** 触发描述，如 "CRON 每周一 09:00" */
  triggerDesc?: string
  /** 节点缩略（type=触发/动作/通知…；label=展示名） */
  nodes?: { type: string; label: string }[]
}

/** ⑧ 单据模板草稿卡：自然语言 → BdTemplateV2 草稿，去模板设计器编辑（永不直接发布） */
export interface AiTemplateDraftCard {
  type: "templateDraft"
  draftId: string
  name: string
  /** 版式块缩略（type=表头/表格/落款…） */
  blocks?: { type: string; label: string }[]
}

/** ⑧ 表单草稿卡：自然语言 → 表单 widgets 草稿，去表单设计器编辑 */
export interface AiFormDraftCard {
  type: "formDraft"
  draftId: string
  name: string
  /** 字段缩略（label + 控件类型） */
  fields?: { label: string; type: string }[]
}

export type AiCard =
  | AiNavigateCard
  | AiConfirmCard
  | AiFormCard
  | AiListCard
  | AiChartCard
  | AiLinkCard
  | AiFlowDraftCard
  | AiTemplateDraftCard
  | AiFormDraftCard

/** V2 批C 引用溯源（TextPart citations[]）：FEATURE 类可走 Registry 导航 */
export interface AiCitation {
  sourceType: "FEATURE" | "RAG_DOC" | (string & {})
  sourceId: string
  title: string
  version?: string
}

/* ============================ 附件 / 模型（§11 增强批） ============================ */

/**
 * 多模态附件（§17）。批D fileId 化：选文件先 POST /api/ai/attachments 得 attachmentId + url，
 * 聊天仅传 {attachmentId,kind,name}（禁止大图 dataUrl 入消息表，§17.1）；上传失败/兼容期回退 dataUrl。
 */
export interface AiAttachment {
  kind: "IMAGE" | "TEXT"
  name: string
  /** 上传成功后的服务端附件 id（fileId 化主路径） */
  attachmentId?: string
  /** 服务端回显地址（图片 src 优先用它，缺省回退 dataUrl） */
  url?: string
  /** 兼容期/上传失败回退：本地 dataURL（预览 + 旧协议发送） */
  dataUrl?: string
  fileId?: number
  /** 字节数（chip 展示） */
  size?: number
}

/** ai_user_memory 长期记忆（§13.4：用户可查看、可删除） */
export interface AiMemory {
  id: string
  /** EXPLICIT 显式记住 / INFERRED 推断 / SYSTEM_PREF 系统偏好 */
  memoryType: "EXPLICIT" | "INFERRED" | "SYSTEM_PREF" | (string & {})
  memoryKey: string
  memoryValue: string
  updatedAt?: string
}

/** 晨报单行（亮点⑤）：可点跳转（featureCode 走 route-registry；过渡期 path 直通） */
export interface AiBriefingItem {
  title: string
  /** 分类：急事 / 会议 / 待阅 */
  kind?: "URGENT" | "MEETING" | "UNREAD" | (string & {})
  /** 受控导航（后端 ai_feature_catalog 同约定编码） */
  featureCode?: string
  routeParams?: Record<string, unknown>
  /** 过渡期直接站内 path（后端已校验在可见菜单内） */
  path?: string
  /** 附带时间/节点等副标题 */
  meta?: string
}

/** 主动晨报（亮点⑤）：每日首次打开面板置顶简报卡（急事/会议/待阅，可关） */
export interface AiBriefing {
  /** 自然日 YYYY-MM-DD（当日关闭判定） */
  date: string
  greeting?: string
  urgentCount: number
  meetingCount: number
  unreadCount: number
  items: AiBriefingItem[]
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
