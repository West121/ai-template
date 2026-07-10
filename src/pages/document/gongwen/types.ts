/**
 * 中国式公文（发文 / 收文）高级化 —— 前端领域模型与常量。
 *
 * 契约来源：docs/design/gongwen-advanced.md（第 2 节数据模型 / 第 5 节 API / 第 7 节 GB/T 9704 版式）。
 * 后端前缀 `/api/office/doc`。字段命名与迁移 V20 扩列对齐（copy_no→copyNo 等驼峰）。
 */

/** 办文方向 */
export type GwDirection = "SEND" | "RECEIVE"

/** 附件（file id + 说明），对应 oa_document.attachments(JSON) */
export interface GwAttachment {
  fileId?: string
  name: string
  size?: number
}

/** 办文意见 / 处理签（oa_doc_opinion），构成办理时间线 */
export interface GwOpinion {
  id: number
  /** 环节 key：拟稿/核稿/会签/签发/用印/拟办/批办/承办/传阅… */
  taskKey: string
  userId?: number
  userName: string
  opinion: string
  /** 决策：AGREE 同意 / REJECT 退回 / TRANSFER 转办 / SIGN 签发 / SEAL 用印 / SUBMIT 提交 */
  decision: string
  createdAt: string
}

/** 传阅回执（oa_doc_circulation） */
export interface GwCirculation {
  id: number
  readerId: number
  readerName: string
  status: "PENDING" | "READ"
  readAt?: string
  opinion?: string
}

/** 公文主数据（列表 + 详情共用；详情附带 opinions/circulations/当前环节） */
export interface GwDoc {
  id: number
  direction: GwDirection
  /** 正式文号（签发占号后回填），拟稿阶段为草稿号/占位 */
  code: string
  title: string
  /** 文种：通知/通报/报告/请示/批复/意见/函/纪要/决定… */
  docType: string
  /** 密级：PUBLIC 公开 / INTERNAL 内部 / SECRET 秘密 / CONFIDENTIAL 机密 */
  secret: string
  /** 紧急程度：NORMAL 普通 / URGENT 加急 / EXTRA 特急 */
  urgency: string
  status: string

  /* ---- GB/T 9704 版式字段 ---- */
  /** 份号（涉密公文用，如 000123） */
  copyNo?: string
  /** 签发人（上行文右上标注） */
  issuer?: string
  /** 发文机关标志（红头文字，如"星辰科技有限公司文件"） */
  issuingOrg?: string
  /** 主送机关（；分隔或多单位） */
  mainRecipients?: string
  /** 抄送机关 */
  ccRecipients?: string
  /** 正文（富文本 HTML） */
  content?: string
  /** 附件 */
  attachments?: GwAttachment[]
  /** 附注（如"此件公开发布"） */
  annotation?: string
  /** 引用的红头/正文套版模板 id */
  templateId?: number
  /** 成文日期（右空四字） */
  docDate?: string

  /* ---- 用印 ---- */
  /** NONE 未用印 / PENDING 待用印 / SEALED 已用印 */
  sealStatus?: string
  sealedBy?: string
  sealedAt?: string

  /* ---- 流转 / 归档 ---- */
  drafter?: string
  deptName?: string
  createdAt?: string
  processInstanceId?: string
  archived?: boolean
  archiveNo?: string
  archivedAt?: string
  /** 归档类别（用于卷宗检索） */
  archiveCategory?: string

  /* ---- 收文专有 ---- */
  /** 来文单位 */
  sourceUnit?: string
  /** 来文字号 */
  sourceCode?: string
  /** 收文登记号 */
  registerNo?: string
  /** 签收 / 登记日期 */
  receivedAt?: string

  /* ---- 详情专有 ---- */
  /** 当前 Flowable 环节名 */
  currentNode?: string
  /** 当前环节 task key（决定操作面板呈现哪些动作） */
  currentTask?: string
  /** 办理时间线（各环节意见 / 签发 / 用印留痕） */
  opinions?: GwOpinion[]
  /** 传阅单 */
  circulations?: GwCirculation[]
}

/** 文号台账行（oa_doc_number_ledger） */
export interface GwLedgerRow {
  id: number
  docNumber: string
  documentId?: number
  docTitle: string
  issuedAt?: string
  issuer?: string
  /** ACTIVE 占用 / VOIDED 作废（作废不回收，置灰） */
  status: "ACTIVE" | "VOIDED"
  ruleName?: string
  year?: string
}

/** 红头 / 正文套版模板（oa_doc_template） */
export interface GwTemplate {
  id: number
  code: string
  name: string
  /** HEADER 红头 / BODY 正文 / FULL 整版 */
  type: string
  issuingOrg?: string
}

/* ============================ 常量 / 元数据 ============================ */

/** 文种（党政机关公文 15 种 + 会议纪要，取企业常用子集） */
export const DOC_TYPES = [
  "通知",
  "通报",
  "报告",
  "请示",
  "批复",
  "意见",
  "决定",
  "函",
  "纪要",
  "公告",
  "通告",
  "议案",
] as const

export interface BadgeMeta {
  label: string
  className: string
}

/** 密级元数据（GB/T：份号 + 密级★保密期限 顶端标注） */
export const SECRET_META: Record<string, BadgeMeta> = {
  PUBLIC: { label: "公开", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  INTERNAL: { label: "内部", className: "border-amber-500/30 bg-amber-500/10 text-amber-600" },
  SECRET: { label: "秘密", className: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
  CONFIDENTIAL: { label: "机密", className: "border-rose-600/40 bg-rose-600/15 text-rose-700" },
}

export const URGENCY_META: Record<string, BadgeMeta> = {
  NORMAL: { label: "普通", className: "text-muted-foreground" },
  URGENT: { label: "加急", className: "border-amber-500/30 bg-amber-500/10 text-amber-600" },
  EXTRA: { label: "特急", className: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
}

/** 发文状态机（设计文档 2.1）：DRAFT→REVIEWING→ISSUED→SEALED→PUBLISHED→ARCHIVED，VOIDED 作废 */
export const SEND_STATUS_META: Record<string, BadgeMeta> = {
  DRAFT: { label: "拟稿", className: "text-muted-foreground" },
  REVIEWING: { label: "核稿中", className: "border-amber-500/30 bg-amber-500/10 text-amber-600" },
  ISSUED: { label: "已签发", className: "border-blue-500/30 bg-blue-500/10 text-blue-600" },
  SEALED: { label: "已用印", className: "border-violet-500/30 bg-violet-500/10 text-violet-600" },
  PUBLISHED: { label: "已成文", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  ARCHIVED: { label: "已归档", className: "border-slate-500/30 bg-slate-500/10 text-slate-600" },
  VOIDED: { label: "已作废", className: "border-rose-500/30 bg-rose-500/10 text-rose-500 line-through" },
}

/** 收文状态机：REGISTERED→ASSIGNING→APPROVING→HANDLING→CIRCULATING→FINISHED→ARCHIVED */
export const RECV_STATUS_META: Record<string, BadgeMeta> = {
  REGISTERED: { label: "已登记", className: "text-muted-foreground" },
  ASSIGNING: { label: "拟办", className: "border-amber-500/30 bg-amber-500/10 text-amber-600" },
  APPROVING: { label: "批办", className: "border-blue-500/30 bg-blue-500/10 text-blue-600" },
  HANDLING: { label: "承办", className: "border-violet-500/30 bg-violet-500/10 text-violet-600" },
  CIRCULATING: { label: "传阅", className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600" },
  FINISHED: { label: "已办结", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  ARCHIVED: { label: "已归档", className: "border-slate-500/30 bg-slate-500/10 text-slate-600" },
}

/** 办文意见决策元数据（时间线圆点 + 标签） */
export const DECISION_META: Record<string, { label: string; dot: string }> = {
  SUBMIT: { label: "提交", dot: "bg-blue-500" },
  AGREE: { label: "同意", dot: "bg-emerald-500" },
  REJECT: { label: "退回", dot: "bg-rose-500" },
  TRANSFER: { label: "转办", dot: "bg-amber-500" },
  SIGN: { label: "签发", dot: "bg-blue-600" },
  SEAL: { label: "用印", dot: "bg-violet-500" },
  READ: { label: "已阅", dot: "bg-slate-400" },
  URGE: { label: "催办", dot: "bg-amber-500" },
  ARCHIVE: { label: "归档", dot: "bg-slate-500" },
}

export function statusMeta(direction: GwDirection, status: string): BadgeMeta {
  const table = direction === "SEND" ? SEND_STATUS_META : RECV_STATUS_META
  return table[status] ?? { label: status, className: "text-muted-foreground" }
}

export function gwFormatDate(iso?: string): string {
  if (!iso) return "—"
  return iso.slice(0, 10)
}

export function gwFormatTime(iso?: string): string {
  if (!iso) return "—"
  return iso.slice(0, 16).replace("T", " ")
}
