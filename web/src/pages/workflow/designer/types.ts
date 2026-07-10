/**
 * 工作流定义域前端类型（本目录自建，不依赖 src/types/workflow.ts）。
 *
 * 契约依据 docs/workflow-design.md §6（/api/wf）：api-contract.md 工作流域
 * 由后端 agent 写入后若有出入，以契约文件为准做适配。
 */
import type { OrgRef } from "@/components/org-picker"

export type WfDefStatus = "DRAFT" | "PUBLISHED" | "DISABLED"

export const WF_STATUS_META: Record<WfDefStatus, { label: string; className: string }> = {
  DRAFT: { label: "草稿", className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  PUBLISHED: {
    label: "已发布",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  DISABLED: { label: "已停用", className: "border-slate-500/30 bg-slate-500/10 text-slate-500" },
}

/* ---------------- 表单定义 ---------------- */

export interface FormDefItem {
  id: number
  code: string
  name: string
  version: number
  status: WfDefStatus
  remark?: string | null
  createdBy?: string | null
  createdAt?: string | null
}

/* ---------------- 流程定义 ---------------- */

/**
 * 流程设计器类型：
 *  - DINGTALK：仿钉钉线性设计器（并存保留）。
 *  - GRAPH：新一代 react-flow 图设计器（归一化 ProcessModel，后端 GraphToBpmnConverter 直译）。
 *  - BPMN：旧 bpmn-js 设计器（已下线，仅存量定义识别用；编辑时经 /api/wf/models/import 迁移为 GRAPH）。
 */
export type DesignerType = "DINGTALK" | "GRAPH" | "BPMN"

/**
 * 表单绑定类型（术语对齐 FormFieldManifest / 后端 ProcessDef.form_type）：
 *  - `ONLINE`：在线表单，绑一个在线设计器表单 formCode，字段从 schemaJson 派生。
 *  - `CODE`：代码表单，绑一个已登记 CODE 表单 formKey，字段从登记清单取；可选带 formSubmitPath（自定义发起页）。
 * 兼容读旧值：`DYNAMIC→ONLINE`、`CUSTOM→CODE`（存量流程不炸）。
 */
export type FormType = "ONLINE" | "CODE"

/** 归一化表单类型（兼容旧 DYNAMIC/CUSTOM）；缺省视为 ONLINE */
export function normalizeFormType(raw?: string | null): FormType {
  return raw === "CODE" || raw === "CUSTOM" ? "CODE" : "ONLINE"
}

export interface ProcessDefItem {
  id: number
  defCode: string
  name: string
  category?: string | null
  icon?: string | null
  /** 表单类型；后端可能仍下发旧值 DYNAMIC/CUSTOM，读取时用 normalizeFormType 归一 */
  formType?: FormType | string | null
  formCode?: string | null
  formVersion?: number | null
  /** CODE：可选自定义发起页 React 路由 */
  formSubmitPath?: string | null
  /** CODE：可选详情查看 React 路由 */
  formViewPath?: string | null
  designerType: DesignerType
  designerJson?: string | null
  bpmnXml?: string | null
  version?: number | null
  status: WfDefStatus
  remark?: string | null
  createdBy?: string | null
  createdAt?: string | null
}

/* ---------------- 仿钉钉设计器：节点属性（nodeProps） ---------------- */

/**
 * 审批人规则（两维模型：类型(kind) × 来源(source)，对齐 docs/superpowers/specs/2026-07-08-assignee-model-2d-design.md）。
 *
 * kind 回答 WHO（组织实体 + 两个快捷类型），source 回答 HOW（解析策略）。
 * 反序列化对旧扁平 designerJson（type 判别字段 / 废弃 kind / RELATED_TO_APPLICANT 来源）做兼容映射，见 dingtalk/serialize.ts。
 */
export type AssigneeKind =
  | "ACCOUNT" // 账户（人员）
  | "ROLE" // 角色
  | "POST" // 岗位
  | "DEPT" // 部门
  | "LEADER" // 发起人主管（快捷：第 N 级）
  | "INITIATOR" // 发起人本人（快捷）

/** 来源（HOW，解析策略） */
export type AssigneeSource =
  | "FIXED" // 固定：picker/文本直接指定
  | "FORM_FIELD" // 来自表单字段
  | "VARIABLE" // 来自流程变量
  | "FORMULA" // 来自公式
  | "APPLICANT" // 与申请人相关（部门：申请人所在部门）
  | "PREV_HANDLER" // 与上个办理人相关
  | "NODE_HANDLER" // 与指定节点办理人相关

export interface AssigneeRule {
  kind: AssigneeKind
  /** 来源；LEADER/INITIATOR 快捷类型可省略（隐含） */
  source?: AssigneeSource
  /** FIXED（账户/角色/部门）：OrgPicker 选择 */
  refs?: OrgRef[]
  /** FIXED（岗位）：岗位名/编码，逗号分隔 */
  postName?: string
  /** FORM_FIELD：选人字段 key */
  field?: string
  /** VARIABLE：流程变量名 */
  varName?: string
  /** FORMULA：公式表达式 */
  formula?: string
  /** APPLICANT：目前仅 "DEPT"（申请人所在部门） */
  applicantValue?: "DEPT"
  /** NODE_HANDLER：目标节点 id */
  fromNodeId?: string
  /** PREV_HANDLER/NODE_HANDLER：取其直属主管 */
  takeLeader?: boolean
  /** LEADER：第 N 级主管 */
  level?: number
}

/** @deprecated 兼容别名，等价 AssigneeKind */
export type AssigneeRuleType = AssigneeKind

export type MultiMode = "ANY" | "ALL" | "SEQUENCE" | "VOTE"
export type EmptyStrategy = "AUTO_PASS" | "TO_ADMIN" | "BLOCK"

export const MULTI_MODE_META: Record<MultiMode, { label: string; description: string }> = {
  ANY: { label: "或签", description: "一名审批人同意即可通过" },
  ALL: { label: "会签", description: "所有审批人同时收到，全部同意才通过" },
  SEQUENCE: { label: "依次审批", description: "按顺序逐一审批，全部同意才通过" },
  VOTE: { label: "票签", description: "按赞成权重占比达到阈值即通过（票签·按比例）" },
}

/** 票签权重：对指定成员（userId）配置权重，未配默认 1 */
export interface VoteWeight {
  userId: number
  weight: number
}

/** 票签配置（multiMode=VOTE 时生效）：通过阈值 + 可选成员权重 */
export interface VoteConfig {
  /** 通过阈值 0-1：赞成权重占比超过该值通过 */
  threshold: number
  /** 成员权重（可选）：未配的成员运行时按默认权重 1 计 */
  weights: VoteWeight[]
}

export const EMPTY_STRATEGY_META: Record<EmptyStrategy, string> = {
  AUTO_PASS: "自动通过",
  TO_ADMIN: "转交管理员",
  BLOCK: "阻塞并提醒",
}

/** 结构化条件：字段 / 操作符 / 值（后端编译为 UEL） */
export type ConditionOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "notContains"

export const OPERATOR_META: Record<ConditionOperator, string> = {
  eq: "等于",
  ne: "不等于",
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于",
  contains: "包含",
  notContains: "不包含",
}

export interface ConditionItem {
  /** 绑定表单 widget 的稳定 key */
  field: string
  operator: ConditionOperator
  value: string
}

export interface BranchCondition {
  logic: "AND" | "OR"
  items: ConditionItem[]
  /** 默认分支：其他条件都不满足时进入 */
  isDefault?: boolean
}

/* ---------------- P1 节点级扩展（nodeConfig 契约，见 docs/flow-designer-v2.md） ---------------- */

/** 按钮操作白名单（对应 P2 已实现的中国式操作） */
export type AllowedOp =
  | "approve"
  | "reject"
  | "transfer"
  | "delegate"
  | "addSign"
  | "counterSign"
  | "assist"
  | "retrieve"
  | "print"

/** 办理选项（精简后：后端真读取者 + 纯前端办理页行为）。多人审批模式统一走基础属性 multiMode。 */
export interface HandleOptions {
  /** 候选人认领（后端读） */
  candidate: boolean
  /** 历史审批人优先（后端读） */
  historyFirst: boolean
  /** 符合规则自动跳过（后端读） */
  autoSkip: boolean
  /** 默认勾选所有办理人（纯前端办理页行为） */
  accountChecked: boolean
  /** 办理人只读不可改（纯前端办理页行为） */
  accountDisabled: boolean
}

/* ---------------- P2 审核菜单 / 超时 / 表单字段权限 ---------------- */

/** 审核菜单：是否允许跳转 / 退回（后端按节点声明放开对应动作） */
export interface AuditMenu {
  allowJump: boolean
  allowReturn: boolean
}

/** 超时动作 */
export type TimeoutAction = "NOTIFY" | "AUTO_PASS" | "AUTO_REJECT"

export const TIMEOUT_ACTION_META: Record<TimeoutAction, string> = {
  NOTIFY: "仅提醒",
  AUTO_PASS: "自动同意",
  AUTO_REJECT: "自动驳回",
}

export interface NodeTimeout {
  /** 超时时长（小时），null=不限 */
  hours: number | null
  action: TimeoutAction
  /** 每隔 N 小时提醒一次，null=不重复 */
  remindEvery: number | null
}

/** 表单字段权限：字段 key → 权限 */
export type FormPerm = "HIDDEN" | "READ" | "EDIT"

export const FORM_PERM_META: Record<FormPerm, string> = {
  HIDDEN: "隐藏",
  READ: "只读",
  EDIT: "可编辑",
}

export type FormPerms = Record<string, FormPerm>

/* ---------------- P3 节点事件（精简为后端真分发的 6 种触发类型） ---------------- */

export type EventTrigger =
  | "ACTIVITY_CONFIRM_PARTICIPANTS" // 节点就绪确认参与者
  | "TASK_AFTER_CREATED" // 任务创建后
  | "TASK_BEFORE_COMPLETE" // 办理完成前
  | "TASK_AFTER_COMPLETE" // 办理完成后
  | "TASK_BEFORE_UNDO" // 撤办前
  | "TASK_AFTER_UNDO" // 撤办后

export type EventAction = "NOTIFY" | "WEBHOOK" | "SCRIPT" | "API" | "DELEGATE"

/**
 * 事件脚本体（action=SCRIPT 用）：与 flow/model.ts 的 `ScriptConfig`（lang+code）字节对齐/结构等价。
 * 此处内联声明而非 import ScriptConfig，避免 types → flow/model → shared/config → types 的循环依赖；
 * 结构相同故可直接传给 `@/components/script-editor` 的 `ScriptEditor`（结构化类型）。
 */
export interface EventScript {
  lang: "groovy" | "js" | "python"
  code: string
}

/**
 * 完整 HTTP 调用配置（action=API 用）。
 * headers/body 为文本：headers 每行 `Name: Value`；body 可为 JSON / 模板串（后端按需插值）。
 */
export interface EventApiConfig {
  method: "GET" | "POST" | "PUT" | "DELETE"
  url: string
  /** 请求头文本（每行 `Name: Value`），可空 */
  headers?: string
  /** 请求体文本（JSON / 模板串），可空 */
  body?: string
}

/**
 * 事件动作载荷（NodeEvent / ProcessEvent 共用）：action 判别 + 各动作专属字段。
 * 切换 action 时序列化侧只保留当前 action 对应的字段（见 property-panel 事件区）。
 */
export interface EventActionConfig {
  action: EventAction
  /**
   * 阻断办理：仅前置触发点（TASK_BEFORE_COMPLETE/TASK_BEFORE_UNDO/PROCESS_START）有意义。
   * true 时该动作失败（脚本 false/异常、API 非 2xx、DELEGATE 抛异常）中止本次办理并回滚；false（默认）fire-and-forget。
   * 与后端 OaEventDelegate 的 blocking 契约对齐；AFTER 类触发点忽略此开关。
   */
  blocking?: boolean
  /** action=NOTIFY 用 */
  notify?: { to: OrgRef[]; template: string }
  /** action=WEBHOOK 用（保留：简单回调 URL） */
  webhookUrl?: string
  /** action=SCRIPT 用：交后端 ScriptService 执行（同 wf:script:write 治理） */
  script?: EventScript
  /** action=API 用：完整 HTTP（method/url/headers/body） */
  api?: EventApiConfig
  /**
   * action=DELEGATE 用：自定义监听器 = 后端受信 Spring bean 名（实现 WfEventHandler）。
   * 运行时 applicationContext.getBean(bean, WfEventHandler.class).handle(ctx)。治理同 wf:script:write。
   */
  delegate?: { bean: string }
}

export interface NodeEvent extends EventActionConfig {
  trigger: EventTrigger
}

/** 单个节点（审批/抄送/分支）的属性集合，keyed by nodeId/branchId 挂在 designerJson.nodeProps */
export interface WfNodeProps {
  assigneeRules?: AssigneeRule[]
  multiMode?: MultiMode
  /** multiMode=VOTE 时的票签配置（阈值 + 权重） */
  voteConfig?: VoteConfig
  emptyStrategy?: EmptyStrategy
  ccUsers?: OrgRef[]
  condition?: BranchCondition
  /** P1：按钮操作白名单 */
  allowedOps?: AllowedOp[]
  /** P1/P2：办理选项 */
  handleOptions?: HandleOptions
  /** P2：审核菜单（跳转/退回） */
  auditMenu?: AuditMenu
  /** P2：审批意见必填 */
  commentRequired?: boolean
  /** P2：节点超时 */
  timeout?: NodeTimeout
  /** P2：表单字段权限 */
  formPerms?: FormPerms
  /** P3：节点事件 */
  events?: NodeEvent[]
}

export type NodePropsMap = Record<string, WfNodeProps>

/* ---------------- 保存载荷 ---------------- */

export interface FormSchemaJson {
  title?: string
  widgets: unknown[]
}

export interface SaveFormDefPayload {
  code: string
  name: string
  schemaJson: FormSchemaJson
  remark?: string
}

export interface SaveProcessDefPayload {
  defCode: string
  name: string
  category?: string
  icon?: string
  designerType: DesignerType
  formType?: FormType
  formCode?: string
  formVersion?: number
  formSubmitPath?: string
  formViewPath?: string
  designerJson?: string
  bpmnXml?: string
  remark?: string
}
