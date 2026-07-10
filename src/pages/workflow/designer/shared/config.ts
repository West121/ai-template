/**
 * 共享属性面板数据契约（流程级 flowConfig + 节点级扩展 + 元数据 + 默认值）。
 *
 * 两个设计器（仿钉钉 / BPMN）共用：
 *  - 仿钉钉：flowConfig 存 designerJson.flowConfig；节点扩展存 designerJson 节点内联字段
 *  - BPMN：flowConfig 存 process extensionElements oa:flowConfig；节点扩展存 oa:nodeConfig
 *
 * 详见 docs/flow-designer-v2.md「P1 数据契约」节。
 */
import type { OrgRef, OrgRefType } from "@/components/org-picker"
import type {
  AllowedOp,
  AssigneeKind,
  AssigneeSource,
  EventAction,
  EventActionConfig,
  EventTrigger,
  HandleOptions,
  VoteConfig,
} from "../types"

/* ---------------- 表单可绑定字段（供条件/表单字段规则/任务标题变量选择） ---------------- */

export interface FormFieldOption {
  key: string
  label: string
  /** 是否为选人类字段（user 控件）：可作 FORM_FIELD 审批人来源 */
  isUser: boolean
}

/* ---------------- 流程级 flowConfig ---------------- */

/** 流程操作开关（后端真读取：作废/收回/催办/撤销 是否可用） */
export interface FlowOperations {
  terminate: boolean
  retrieve: boolean
  urge: boolean
  cancel: boolean
}

/** 流程启动 */
export interface FlowStart {
  /** 启动权限（空 = 不限，后端真校验发起人是否在 scope 内） */
  scope: OrgRef[]
  taskTitle: string
}

/* ---------------- 流程变量 ---------------- */

/** 流程变量类型 */
export type FlowVarType = "STRING" | "NUMBER" | "BOOLEAN" | "DATE" | "JSON"

export const FLOW_VAR_TYPE_META: Record<FlowVarType, string> = {
  STRING: "字符串",
  NUMBER: "数字",
  BOOLEAN: "布尔",
  DATE: "日期",
  JSON: "JSON",
}

export interface FlowVariable {
  name: string
  type: FlowVarType
  defaultValue: string
}

/* ---------------- 流程级事件 ---------------- */

/** 流程级事件触发点（后端在流程实例生命周期分发） */
export type ProcessEventTrigger = "PROCESS_START" | "PROCESS_END" | "PROCESS_CANCEL"

export const PROCESS_EVENT_TRIGGER_META: Record<ProcessEventTrigger, string> = {
  PROCESS_START: "流程启动后",
  PROCESS_END: "流程结束后",
  PROCESS_CANCEL: "流程撤销 / 作废后",
}

/**
 * 流程级事件：与 NodeEvent 复用同一动作载荷（EventActionConfig：NOTIFY/WEBHOOK/SCRIPT/API），
 * 仅触发点不同（ProcessEventTrigger）。
 */
export interface ProcessEvent extends EventActionConfig {
  trigger: ProcessEventTrigger
}

/** 流程级配置（存 ProcessDef.designerJson.flowConfig / BPMN oa:flowConfig） */
export interface FlowConfig {
  operations: FlowOperations
  start: FlowStart
  /** 流程变量 */
  variables: FlowVariable[]
  /** 流程级事件（启动/结束/撤销时执行 通知/Webhook/脚本/API） */
  events?: ProcessEvent[]
}

/** 流程基础信息（存 ProcessDef 顶层列：name/remark/icon/category，非 flowConfig） */
export interface ProcessBase {
  name: string
  description: string
  icon: string
  category: string
}

/** 共享面板 process target 的复合 config：基础信息 + 流程级配置 */
export interface ProcessConfig {
  base: ProcessBase
  flow: FlowConfig
}

/* ---------------- 默认值 ---------------- */

export function defaultFlowConfig(): FlowConfig {
  return {
    operations: {
      terminate: true,
      retrieve: false,
      urge: false,
      cancel: true,
    },
    start: {
      scope: [],
      taskTitle: "",
    },
    variables: [],
  }
}

/** 审批节点默认按钮操作白名单 */
export const DEFAULT_ALLOWED_OPS: AllowedOp[] = ["approve", "reject", "transfer", "addSign"]

/** 票签默认配置：过半数（>50%）通过、无成员权重 */
export function defaultVoteConfig(): VoteConfig {
  return { threshold: 0.5, weights: [] }
}

export function defaultHandleOptions(): HandleOptions {
  return {
    candidate: false,
    historyFirst: true,
    autoSkip: false,
    accountChecked: true,
    accountDisabled: false,
  }
}

/* ---------------- 元数据（标签） ---------------- */

/** 按钮操作白名单元数据（对应 P2 已实现的中国式操作） */
export const ALLOWED_OP_META: Record<AllowedOp, { label: string; description: string }> = {
  approve: { label: "同意 / 办理", description: "通过当前任务，进入下一节点" },
  reject: { label: "驳回", description: "退回发起人或指定历史节点" },
  transfer: { label: "转办", description: "把任务整体移交他人办理" },
  delegate: { label: "委托 / 代办", description: "委托他人代为办理，办理后归还" },
  addSign: { label: "加签", description: "临时增加前置 / 后置审批人" },
  counterSign: { label: "会签", description: "召集多人共同会签" },
  assist: { label: "协同 / 阅办", description: "邀请他人协同处理或阅知" },
  retrieve: { label: "撤回", description: "办理人撤回已提交的办理" },
  print: { label: "打印", description: "打印表单 / 审批单" },
}

/* ---------------- 办理人类型(kind) × 来源(source) 两维元数据（对齐 assignee-model-2d-design.md） ---------------- */

export const ASSIGNEE_KIND_META: Record<AssigneeKind, { label: string }> = {
  ACCOUNT: { label: "账户" },
  ROLE: { label: "角色" },
  POST: { label: "岗位" },
  DEPT: { label: "部门" },
  LEADER: { label: "发起人主管" },
  INITIATOR: { label: "发起人本人" },
}

export const ASSIGNEE_SOURCE_META: Record<AssigneeSource, { label: string; hint?: string }> = {
  FIXED: { label: "固定指定" },
  FORM_FIELD: { label: "来自表单字段" },
  VARIABLE: { label: "来自流程变量" },
  FORMULA: { label: "来自公式" },
  APPLICANT: { label: "与申请人相关", hint: "申请人所在部门" },
  PREV_HANDLER: { label: "与上个办理人相关" },
  NODE_HANDLER: { label: "与指定节点办理人相关" },
}

/** 每种类型允许的来源（上下文下拉）；LEADER/INITIATOR 无来源选择 */
export const ASSIGNEE_SOURCE_MATRIX: Record<AssigneeKind, AssigneeSource[]> = {
  ACCOUNT: ["FIXED", "FORM_FIELD", "VARIABLE", "FORMULA", "PREV_HANDLER", "NODE_HANDLER"],
  ROLE: ["FIXED"],
  POST: ["FIXED"],
  DEPT: ["FIXED", "APPLICANT"],
  LEADER: [],
  INITIATOR: [],
}

/** 类型对应的固定选人范围（复用 OrgPicker types 限制；POST 走文本不在此列） */
export const ASSIGNEE_FIXED_REF_TYPES: Partial<Record<AssigneeKind, OrgRefType[]>> = {
  ACCOUNT: ["USER"],
  ROLE: ["ROLE"],
  DEPT: ["DEPT"],
}

/* ---------------- P2 办理选项 / 审核菜单 元数据 ---------------- */

/** 办理选项开关项（label + 描述），顺序即展示顺序 */
export const HANDLE_OPTION_SWITCHES: {
  key: keyof HandleOptions
  label: string
  description: string
}[] = [
  { key: "candidate", label: "候选人认领", description: "办理人为候选，需先认领任务" },
  { key: "historyFirst", label: "历史审批人优先", description: "同节点历史办理人优先分派" },
  { key: "autoSkip", label: "自动跳过", description: "符合规则时自动跳过本节点" },
  { key: "accountChecked", label: "默认勾选", description: "默认勾选所有办理人（办理页行为）" },
  { key: "accountDisabled", label: "办理人只读", description: "办理人不可改动（办理页行为）" },
]

/* ---------------- 节点事件 元数据（后端真分发的 6 种触发类型） ---------------- */

export const EVENT_TRIGGER_META: Record<EventTrigger, string> = {
  ACTIVITY_CONFIRM_PARTICIPANTS: "节点就绪·确认参与者",
  TASK_AFTER_CREATED: "任务创建后",
  TASK_BEFORE_COMPLETE: "办理完成前",
  TASK_AFTER_COMPLETE: "办理完成后",
  TASK_BEFORE_UNDO: "撤办前",
  TASK_AFTER_UNDO: "撤办后",
}

export const EVENT_ACTION_META: Record<EventAction, string> = {
  NOTIFY: "发送通知",
  WEBHOOK: "调用 Webhook",
  SCRIPT: "执行脚本",
  API: "调用 API",
}
