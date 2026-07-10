/**
 * 工作流（/api/wf）P1 前端类型与展示元数据。
 * 契约以 docs/api-contract.md 工作流域章节为准（后端并行开发中，先按 docs/workflow-design.md §6 契约实现）。
 */

/* ================= 表单 Widget 模型（与 src/pages/demo/form-designer/model.ts 字段兼容） ================= */

export type WidgetType =
  | "input"
  | "textarea"
  | "number"
  | "radio"
  | "checkbox"
  | "select"
  | "date"
  | "user"
  | "rating"
  | "switch"
  | "divider"
  | "note"
  // v2 容器控件
  | "grid"
  | "group"
  | "tabs"
  | "collapse"
  | "subform"
  // v2 第二波数据控件
  | "upload"
  | "image"
  | "richtext"
  | "amount"
  | "address"
  | "cascade"
  | "relation"
  | "signature"
  | "html"

/* ================= v2 增强子模型（联动 / 校验 / 数据源 / 事件） ================= */

/** 归一化选项 */
export type WidgetOption = { label: string; value: string }

/** 联动 / 条件：field 为其他控件的稳定 key */
export interface FormCondition {
  field: string
  /** eq/ne/gt/gte/lt/lte/contains/notContains/empty/notEmpty/in */
  operator: string
  value?: unknown
}
export interface ConditionGroup {
  logic: "AND" | "OR"
  conditions: FormCondition[]
}

/** 可配置校验规则 */
export type ValidationRule =
  | { type: "required"; message?: string }
  | { type: "regex"; pattern: string; preset?: string; message?: string }
  | { type: "length"; min?: number; max?: number; message?: string }
  | { type: "range"; min?: number; max?: number; message?: string }
  | { type: "unique"; scope?: string; message?: string }
  | { type: "custom"; expr: string; message?: string }

/** 级联树节点（数据源 cascade / address 用） */
export interface CascadeNode {
  label: string
  value: string
  children?: CascadeNode[]
}

/** 选项数据源（第一波：static / dict / form；第二波补齐 api / cascade） */
export type DataSource =
  | { type: "static" }
  | { type: "dict"; dictCode: string }
  | { type: "form"; defCode: string; labelField: string; valueField: string }
  | { type: "api"; url: string; labelField: string; valueField: string }
  | { type: "cascade"; preset?: "region"; tree?: CascadeNode[] }

/** 受限 JS 源码 */
export type Script = string
export interface WidgetEvents {
  onChange?: Script
  onFocus?: Script
  onBlur?: Script
}
export interface FormEvents {
  onLoad?: Script
  onChange?: Script
  onSubmit?: Script
}

export interface FormWidget {
  id: string
  /** 允许后端出现前端未知的控件类型：渲染器对未知类型降级为占位 */
  type: WidgetType | (string & {})
  label: string
  placeholder?: string
  required?: boolean
  description?: string
  /** 占整行还是半行（两列栅格）；{span} 为 24 栅格体系跨列数 */
  width?: "full" | "half" | { span: number }
  /** radio / checkbox / select 的选项（兼容纯字符串或 {label,value} 对象两种 schema） */
  options?: (string | { label: string; value: string })[]
  /** divider / note 的文案 */
  content?: string
  /** 稳定字段标识（发布表单定义时补充）；缺省回退用 id 作为 formData 的键 */
  key?: string
  /* ---- v2 增强（全部可选，旧 schema 不含即回退旧行为） ---- */
  /** 静态默认值 */
  defaultValue?: unknown
  /** 设计期只读（与节点 perms 叠加，任一只读即只读） */
  readonly?: boolean
  /** 设计期隐藏 */
  hidden?: boolean
  /** 可配置校验规则 */
  validation?: ValidationRule[]
  /** 选项数据源 */
  dataSource?: DataSource
  /** 显隐联动：满足则显示，否则隐藏并跳过校验 */
  visibleWhen?: ConditionGroup
  /** 必填联动：满足则必填 */
  requiredWhen?: ConditionGroup
  /** 容器子控件 / subform 列定义 */
  children?: FormWidget[]
  /** 控件专属属性（容器 columns/tabs/panels、number precision 等） */
  props?: Record<string, unknown>
  /** 字段级事件 */
  events?: WidgetEvents
}

export interface FormSchema {
  title?: string
  widgets: FormWidget[]
  /** 表单级事件 onLoad/onChange/onSubmit */
  events?: FormEvents
  /** 表单变量（脚本可读写） */
  variables?: Record<string, unknown>
}

/** 节点级字段权限（P1 默认全 EDIT） */
export type FieldPerm = "HIDDEN" | "READ" | "EDIT"
export type FormPerms = Record<string, FieldPerm>

/** 表单提交/快照数据：key（或 widget.id）→ 值 */
export type WfFormData = Record<string, unknown>

/* ================= 定义 / 发起 ================= */

/**
 * 表单类型：ONLINE=在线表单（可视化设计器）；CODE=代码表单（登记字段清单，可选自定义发起页）。
 * 兼容读旧值 DYNAMIC→ONLINE、CUSTOM→CODE（用 normalizeFormType 归一，见 designer/types.ts）。
 */
export type WfFormType = "ONLINE" | "CODE"

/** GET /api/wf/startable 可发起流程（卡片墙） */
export interface WfStartableDef {
  defCode: string
  name: string
  category?: string
  icon?: string
  formCode?: string
  remark?: string
  /* ---- P1-C 自定义表单 ---- */
  /** 表单类型；缺省视为 DYNAMIC（动态表单弹窗） */
  formType?: WfFormType | string
  /** CUSTOM 时发起页 React 路由（用 navigate 跳转，而非弹动态表单） */
  formSubmitPath?: string
  /** CUSTOM 时详情查看 React 路由 */
  formViewPath?: string
}

/** GET /api/wf/form-defs/{code}/latest 表单定义 */
export interface WfFormDef {
  id: number
  code: string
  name: string
  version: number
  schemaJson: string
  status?: string
  remark?: string
}

/* ================= 实例 / 任务 ================= */

export type WfBizStatus = "DRAFT" | "RUNNING" | "APPROVED" | "REJECTED" | "CANCELED" | "TERMINATED"

export const WF_STATUS_META: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "草稿", className: "border-slate-500/30 bg-slate-500/10 text-slate-500" },
  RUNNING: { label: "审批中", className: "border-blue-500/30 bg-blue-500/10 text-blue-600" },
  APPROVED: { label: "已通过", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  REJECTED: { label: "已驳回", className: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
  CANCELED: { label: "已撤销", className: "border-gray-500/30 bg-gray-500/10 text-gray-500" },
  TERMINATED: { label: "已终止", className: "border-orange-500/30 bg-orange-500/10 text-orange-600" },
}

/** 审批记录时间线一条（timeline = wf_operation ∪ ACT_HI_COMMENT） */
export interface WfTimelineItem {
  nodeId?: string
  nodeName?: string
  actorName?: string
  action: string
  comment?: string
  createdAt?: string
}

/** 跟踪图高亮活动集 */
export interface WfHighlight {
  completed: string[]
  active: string[]
}

/** GET /api/wf/instances/{id} 实例详情 */
export interface WfInstanceDetail {
  id: number
  procInstId: string
  defCode: string
  defName: string
  title: string
  bizStatus: WfBizStatus | string
  initiatorId: number
  initiatorName: string
  createdAt?: string
  endedAt?: string
  /** 表单快照：后端可能返回 JSON 字符串或对象，渲染前统一 parse */
  formSchema?: string | FormSchema
  formData?: string | WfFormData
  currentNodes?: Array<{ nodeId?: string; nodeName?: string }>
  timeline?: WfTimelineItem[]
  highlight?: WfHighlight
  bpmnXml?: string
  canCancel?: boolean
  /** 我在此实例上的待办任务 id（有值时展示同意/驳回操作区） */
  myTaskId?: string | null
  /* ---- P2 扩展 ---- */
  /** 我当前任务可用操作白名单（节点 allowedOps ∩ 权限）；缺省回退 P1 同意/驳回 */
  allowedOps?: string[]
  /** 我具备 wf:instance:admin，可见跳转/终止/追加节点等治理操作 */
  isAdmin?: boolean
  /** 管理员可跳转/驳回指定的目标节点 */
  jumpTargets?: WfNodeRef[]
  /** 沟通线程（不影响流转的留言） */
  comments?: WfComment[]
  /** 我是否已阅本实例（打开详情自动置 true） */
  readByMe?: boolean
  /** 本节点其他待办人（减签候选）；缺省时减签弹窗回退用组织选择器 */
  currentHandlers?: WfHandlerRef[]
  /* ---- P1-C 自定义表单 ---- */
  /** 表单类型；CUSTOM 时详情表单区改用 formViewPath 路由/内嵌，缺省 DYNAMIC 走表单快照 */
  formType?: WfFormType | string
  /** CUSTOM 时详情查看 React 路由 */
  formViewPath?: string
  /* ---- 跟踪图按设计器类型渲染 ---- */
  /** 流程定义的设计器类型：DINGTALK→详情用钉钉风格跟踪图，BPMN(或缺省)→用 bpmn 跟踪图 */
  designerType?: "DINGTALK" | "BPMN" | string
  /** DINGTALK 定义的钉钉模型（{ nodes, flowConfig }）；渲染只读钉钉跟踪图。BPMN 定义为空，用 bpmnXml */
  designerJson?: unknown
}

/** 节点引用（跳转 / 追加节点定位） */
export interface WfNodeRef {
  nodeId: string
  name: string
}

/** 本节点待办人（减签候选） */
export interface WfHandlerRef {
  userId: number
  name: string
  taskId?: string
}

/** 沟通线程一条留言 */
export interface WfComment {
  taskId?: string
  fromName?: string
  content: string
  createdAt?: string
}

/** GET /api/wf/tasks/todo 待办任务项 */
export interface WfTaskItem {
  taskId: string
  procInstId: string
  /** 后端如返回实例扩展表 id，则详情跳转优先用它 */
  instanceId?: number
  instanceTitle: string
  defName: string
  nodeName: string
  initiatorName: string
  createdAt?: string
  /* ---- P2 扩展 ---- */
  /** 分组 CLAIM 节点的待认领任务：办理前需先认领 */
  groupClaim?: boolean
  /** 委派/代理产生的任务 */
  delegated?: boolean
  /**
   * 办理跳转路径（后端下发）：CODE 表单流程(如公文)带 form_view_path 时，
   * 后端解析 businessKey 得到业务详情路由(如 /document/send/67)。
   * 「去处理」优先用它——公文实例走 RuntimeService、无 wf_instance_ext，走通用实例详情会 404。
   */
  viewPath?: string
}

/** GET /api/wf/instances/done-by-me 已办项 */
export interface WfDoneItem {
  taskId?: string
  procInstId: string
  instanceId?: number
  instanceTitle?: string
  title?: string
  defName?: string
  nodeName?: string
  action?: string
  comment?: string
  bizStatus?: WfBizStatus | string
  createdAt?: string
}

/** GET /api/wf/instances/my 我发起的实例 */
export interface WfMyInstance {
  id: number
  procInstId: string
  defCode?: string
  defName?: string
  title: string
  bizStatus: WfBizStatus | string
  currentNodeNames?: string[]
  createdAt?: string
  endedAt?: string
  canCancel?: boolean
}

/** GET /api/wf/instances/cc 抄送我的 */
export interface WfCcItem {
  /** wf_cc 记录 id（标记已读用） */
  id: number
  procInstId: string
  instanceId?: number
  title?: string
  instanceTitle?: string
  defName?: string
  nodeName?: string
  initiatorName?: string
  readFlag?: boolean
  createdAt?: string
}

/* ================= 通知 ================= */

export type WfNotifyType = "TODO" | "RESULT" | "URGE" | "CC"

/** GET /api/wf/notifies 站内通知 */
export interface WfNotify {
  id: number
  type: WfNotifyType | string
  title: string
  content?: string
  procInstId?: string
  instanceId?: number
  readFlag?: boolean
  createdAt?: string
}

export const WF_NOTIFY_TYPE_LABEL: Record<string, string> = {
  TODO: "待办",
  RESULT: "结果",
  URGE: "催办",
  CC: "抄送",
}

/* ================= P2 组织引用 / 操作入参 ================= */

/**
 * 后端契约统一选人入参：kind + id（name 仅回显）。
 * 前端选人用 src/components/org-picker.tsx 的 OrgRef（字段名为 type），
 * 提交前用 wf-op-dialogs.tsx 的 toOrgRef() 转换为此形状。
 */
export interface WfOrgRef {
  kind: "USER" | "DEPT" | "ROLE"
  id: number
  name?: string
}

/** POST tasks/{id}/add-sign 加签 */
export interface WfAddSignInput {
  mode: "PRE" | "POST"
  users: WfOrgRef[]
  comment?: string
}

/** POST tasks/{id}/counter-sign 并签 */
export interface WfCounterSignInput {
  users: WfOrgRef[]
  comment?: string
}

/** POST tasks/{id}/reduce-sign 减签 */
export interface WfReduceSignInput {
  removeUserIds: number[]
}

/** POST tasks/{id}/transfer 转办 / delegate 委派 */
export interface WfAssigneeOpInput {
  user: WfOrgRef
  comment?: string
}

/** POST tasks/{id}/assist 协办/征求意见 */
export interface WfAssistInput {
  users: WfOrgRef[]
  comment: string
}

/** POST tasks/{id}/reject 驳回（增强） */
export interface WfRejectInput {
  target: "PREV" | "START" | "NODE"
  targetNodeId?: string
  comment: string
  resumeStrategy: "CONTINUE" | "BACK"
}

/** POST tasks/{id}/retrieve 拿回 */
export interface WfRetrieveInput {
  comment?: string
}

/** POST tasks/{id}/communicate 沟通留言 */
export interface WfCommunicateInput {
  toUserIds: number[]
  content: string
}

/** POST instances/{id}/jump 管理员跳转 */
export interface WfJumpInput {
  targetNodeId: string
  comment?: string
}

/** POST instances/{id}/terminate 管理员终止 / urge 催办 */
export interface WfCommentInput {
  comment?: string
}

/** POST instances/{id}/append-node 追加节点 */
export interface WfAppendNodeInput {
  afterNodeId: string
  name: string
  assignees: WfOrgRef[]
  multiMode: "ANY" | "ALL" | "SEQUENCE"
}

/** POST wf/handover 离职交接 */
export interface WfHandoverInput {
  fromUserId: number
  toUserId: number
  comment?: string
}

/* ================= P2 草稿 / 代理 / 治理 列表 ================= */

/** POST instances/draft 暂存草稿 */
export interface WfDraftInput {
  defCode: string
  formData: WfFormData
  title?: string
}

/** GET instances/drafts 我的草稿项 */
export interface WfDraftItem {
  id: number
  procInstId?: string
  defCode?: string
  defName?: string
  title?: string
  createdAt?: string
  updatedAt?: string
}

/** GET wf/delegate-rules 委托规则 */
export interface WfDelegateRule {
  id: number
  delegateToId: number
  delegateToName?: string
  defCode?: string | null
  defName?: string
  startDate?: string
  endDate?: string
  enabled: boolean
  createdAt?: string
}

/** POST wf/delegate-rules 新建委托规则入参 */
export interface WfDelegateRuleInput {
  delegateToId: number
  defCode?: string | null
  startDate: string
  endDate: string
  enabled: boolean
}

/** GET instances/admin 管理员全实例列表项 */
export interface WfAdminInstance {
  id: number
  procInstId: string
  defCode?: string
  defName?: string
  title: string
  bizStatus: WfBizStatus | string
  initiatorName?: string
  currentNodeNames?: string[]
  createdAt?: string
  endedAt?: string
}

/* ================= 工具 ================= */

/** 时间显示：ISO → yyyy-MM-dd HH:mm */
export function wfFormatTime(iso?: string) {
  if (!iso) return "—"
  return iso.slice(0, 16).replace("T", " ")
}

/** 详情路由参数：实例扩展表 id 优先，否则用 procInstId（后端两者均可解析） */
export function wfInstancePath(row: { instanceId?: number; id?: number; procInstId?: string }) {
  const key = row.instanceId ?? row.id ?? row.procInstId
  return `/workflow/instances/${key}`
}

/** 容错解析表单 schema：JSON 字符串 / {widgets} 对象 / widgets 数组 */
export function parseFormSchema(raw: unknown): FormSchema {
  let value = raw
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return { widgets: [] }
    }
  }
  if (Array.isArray(value)) return { widgets: value as FormWidget[] }
  if (value && typeof value === "object" && Array.isArray((value as FormSchema).widgets)) {
    const schema = value as FormSchema
    return { title: schema.title, widgets: schema.widgets, events: schema.events, variables: schema.variables }
  }
  return { widgets: [] }
}

/** 容错解析表单数据快照：JSON 字符串或对象 */
export function parseFormData(raw: unknown): WfFormData {
  let value = raw
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as WfFormData
  return {}
}

/** widget 在 formData 中的键：稳定 key 优先，回退 id */
export function widgetKey(widget: FormWidget) {
  return widget.key ?? widget.id
}
