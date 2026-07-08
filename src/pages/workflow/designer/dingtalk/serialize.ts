/**
 * 仿钉钉 designerJson 序列化层：前端内部模型 <-> 后端格式双向适配。
 *
 * 前端内部：{ steps: StepNode[]（节点树）, nodeProps: NodePropsMap（属性分离，按 id 挂） }
 * 后端格式（以此为准，勿改后端）：
 *   { nodes: BackendNode[] }  —— 顶层线性数组，审批人属性内联到节点
 *   - approval: { id,type:"approval",name,assigneeRules[],multiMode,emptyStrategy }
 *       assigneeRules[].ORG.refs = [{kind:"USER"|"DEPT"|"ROLE", id:number}]（无 name）
 *   - cc:       { id,type:"cc",name,users:[{kind,id}] }
 *   - condition:{ id,type:"condition",name,branches:[{id,name,conditions:[{field,operator,value}],default?,steps:[子节点]}] }
 *       operator 用符号（== != > >= < <=）；后端 ConditionCompiler 编译 UEL；分支内 conditions 默认 AND。
 */
import type { OrgRef, OrgRefType } from "@/components/org-picker"
import type {
  AllowedOp,
  AssigneeKind,
  AssigneeRule,
  AssigneeSource,
  AssigneeSourceValue,
  AuditMenu,
  ConditionItem,
  ConditionOperator,
  EmptyStrategy,
  FormPerms,
  HandleOptions,
  MultiMode,
  NodeEvent,
  NodePropsMap,
  NodeTimeout,
  VoteConfig,
  WfNodeProps,
} from "../types"
import { defaultFlowConfig, type FlowConfig } from "../shared/config"
import type {
  AiStep,
  ApprovalStep,
  AutoApproveStep,
  AutoRejectStep,
  Branch,
  BranchContainerStep,
  CcStep,
  StepNode,
  SubprocessStep,
  TimerStep,
  TriggerStep,
} from "./model"

/* ---------------- 后端节点类型 ---------------- */

interface BackendOrgRef {
  kind?: OrgRefType
  /** 设计器产出的引用用 id（后端已验证支持，见联调）；部分种子数据用 username 简写 */
  id?: number
  username?: string
  name?: string
}

/**
 * 后端办理人规则（校准后 kind 契约）。
 * 兼容读取旧 `type` 判别字段（ORG/LEADER/FORM_FIELD/INITIATOR）与旧 kind（ROLE_POST/UNIT/GROUP/SERVICE_API/FIND_LEADER）。
 */
interface BackendAssigneeRule {
  kind?: AssigneeKind | LegacyAssigneeKind
  /** 旧契约判别字段（仅反序列化兼容） */
  type?: "ORG" | "LEADER" | "FORM_FIELD" | "INITIATOR"
  refs?: BackendOrgRef[]
  source?: AssigneeSource
  sourceValue?: AssigneeSourceValue
  level?: number
  /** POST 用：岗位名称 */
  postName?: string
  field?: string
  /** FORMULA 用：自定义公式 */
  formula?: string
  /** 旧字段（反序列化忽略） */
  apiUrl?: string
}

/** 已废弃的旧办理人类型（仅反序列化兼容映射） */
type LegacyAssigneeKind = "ROLE_POST" | "UNIT" | "GROUP" | "SERVICE_API" | "FIND_LEADER"

interface BackendCondition {
  field: string
  operator: string
  value: string | number
}

interface BackendBranch {
  id: string
  name: string
  conditions: BackendCondition[]
  default?: boolean
  steps: BackendNode[]
}

interface BackendApprovalNode {
  id: string
  type: "approval"
  name: string
  assigneeRules: BackendAssigneeRule[]
  multiMode: MultiMode
  /** multiMode=VOTE 时的票签配置（阈值 + 权重 userId→weight） */
  voteConfig?: BackendVoteConfig
  emptyStrategy: EmptyStrategy
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
/** 票签配置（后端契约）：threshold + weights（userId→weight 映射对象） */
interface BackendVoteConfig {
  threshold: number
  weights?: Record<string, number>
}
interface BackendCcNode {
  id: string
  type: "cc"
  name: string
  users: BackendOrgRef[]
}
interface BackendConditionNode {
  id: string
  type: "condition"
  name: string
  branches: BackendBranch[]
}
/** 包容分支（inclusiveGateway）：分支带条件，满足的多条都走 + 默认 */
interface BackendInclusiveNode {
  id: string
  type: "inclusive"
  name: string
  branches: BackendBranch[]
}
/** 并行分支（parallelGateway）：全部分支并行，无条件 */
interface BackendParallelNode {
  id: string
  type: "parallel"
  name: string
  branches: BackendBranch[]
}
/** 自动通过（serviceTask→自动 complete，action=AUTO_APPROVE） */
interface BackendAutoApproveNode {
  id: string
  type: "autoApprove"
  name: string
}
/** 自动拒绝（serviceTask→自动 reject） */
interface BackendAutoRejectNode {
  id: string
  type: "autoReject"
  name: string
}

/* ---- P3 高级节点（属性内联，供后端 JsonToBpmnConverter 读取） ---- */
interface BackendSubprocessNode {
  id: string
  type: "subprocess"
  name: string
  defCode: string
  async: boolean
  /** 子变量 → 父字段 的映射对象 */
  paramMap: Record<string, string>
}
interface BackendTimerNode {
  id: string
  type: "timer"
  name: string
  mode: "duration" | "date"
  value: string
}
interface BackendTriggerNode {
  id: string
  type: "trigger"
  name: string
  triggerType: "IMMEDIATE" | "TIMER"
  handler?: string
  webhookUrl?: string
  timer?: string
}
interface BackendAiNode {
  id: string
  type: "ai"
  name: string
  model: string
  systemPrompt: string
  formContext: string[]
  outputMap: { decision: string; comment: string; route?: string }
}

type BackendNode =
  | BackendApprovalNode
  | BackendCcNode
  | BackendConditionNode
  | BackendInclusiveNode
  | BackendParallelNode
  | BackendAutoApproveNode
  | BackendAutoRejectNode
  | BackendSubprocessNode
  | BackendTimerNode
  | BackendTriggerNode
  | BackendAiNode

export interface BackendDesignerJson {
  nodes: BackendNode[]
  /** P1：流程级配置（流程操作开关 / 启动权限 / 安全 / 其他） */
  flowConfig?: FlowConfig
}

/* ---------------- 操作符符号 <-> 内部枚举 ---------------- */

const OP_TO_SYMBOL: Record<ConditionOperator, string> = {
  eq: "==",
  ne: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  contains: "contains",
  notContains: "notContains",
}

const SYMBOL_TO_OP: Record<string, ConditionOperator> = {
  "==": "eq",
  "=": "eq",
  "!=": "ne",
  "<>": "ne",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  contains: "contains",
  notContains: "notContains",
}

/** 数字字符串转数值（供后端条件求值），否则原样字符串 */
function coerceValue(value: string): string | number {
  const v = value.trim()
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : value
}

/* ---------------- OrgRef <-> {kind,id} ---------------- */

const orgRefToBackend = (r: OrgRef): BackendOrgRef => ({ kind: r.type, id: r.id })

const KIND_LABEL: Record<OrgRefType, string> = { USER: "成员", DEPT: "部门", ROLE: "角色" }

/**
 * 回显：后端引用 → OrgRef。
 * - 设计器产出 `{kind,id}`：id 回填，name 用占位（OrgPicker 打开后按 id 懒显示真实名）
 * - 种子简写 `{kind?,username}`（无 id）：以 username 作展示名，id 缺省为 0（OrgPicker 无法按 username 反查，
 *   仅作只读回显；再保存会丢失该 username——建议此类定义用设计器重选人员，见联调说明）
 */
const backendToOrgRef = (r: BackendOrgRef): OrgRef => {
  const type: OrgRefType = r.kind ?? "USER"
  if (typeof r.id === "number") {
    return { type, id: r.id, name: r.name ?? `${KIND_LABEL[type] ?? ""}#${r.id}` }
  }
  return { type, id: 0, name: r.name ?? r.username ?? `${KIND_LABEL[type] ?? ""}(未指定)` }
}

/* ---------------- 规则 <-> 后端规则 ---------------- */

function ruleToBackend(rule: AssigneeRule): BackendAssigneeRule {
  const out: BackendAssigneeRule = { kind: rule.kind }
  if (rule.refs && rule.refs.length) out.refs = rule.refs.map(orgRefToBackend)
  if (rule.source) out.source = rule.source
  if (rule.sourceValue) out.sourceValue = rule.sourceValue
  if (typeof rule.level === "number") out.level = rule.level
  if (rule.postName) out.postName = rule.postName
  if (rule.field) out.field = rule.field
  if (rule.formula) out.formula = rule.formula
  return out
}

/** 旧 type 判别字段 → 新 kind（反序列化兼容） */
const LEGACY_TYPE_TO_KIND: Record<NonNullable<BackendAssigneeRule["type"]>, AssigneeKind> = {
  ORG: "ACCOUNT",
  LEADER: "LEADER",
  FORM_FIELD: "FORM_FIELD",
  INITIATOR: "INITIATOR",
}

/** 已废弃 kind → 新 kind（反序列化兼容映射；旧 designerJson 不崩） */
const LEGACY_KIND_TO_KIND: Record<LegacyAssigneeKind, AssigneeKind> = {
  ROLE_POST: "ROLE",
  UNIT: "DEPT",
  GROUP: "ACCOUNT",
  SERVICE_API: "ACCOUNT",
  FIND_LEADER: "LEADER",
}

function normalizeKind(rule: BackendAssigneeRule): AssigneeKind {
  if (rule.kind) {
    if (rule.kind in LEGACY_KIND_TO_KIND) return LEGACY_KIND_TO_KIND[rule.kind as LegacyAssigneeKind]
    return rule.kind as AssigneeKind
  }
  return rule.type ? LEGACY_TYPE_TO_KIND[rule.type] : "ACCOUNT"
}

function ruleFromBackend(rule: BackendAssigneeRule): AssigneeRule {
  const kind = normalizeKind(rule)
  const out: AssigneeRule = { kind }
  if (rule.refs) out.refs = rule.refs.map(backendToOrgRef)
  if (rule.source) out.source = rule.source
  if (rule.sourceValue) out.sourceValue = rule.sourceValue
  if (typeof rule.level === "number") out.level = rule.level
  else if (kind === "LEADER") out.level = 1
  if (rule.postName) out.postName = rule.postName
  if (rule.field) out.field = rule.field
  if (rule.formula) out.formula = rule.formula
  return out
}

/* ================= 序列化：内部模型 → 后端 {nodes} ================= */

/** 票签配置 → 后端（weights 数组转 userId→weight 映射对象） */
function voteConfigToBackend(vc: VoteConfig | undefined): BackendVoteConfig | undefined {
  if (!vc) return undefined
  const weights: Record<string, number> = {}
  for (const w of vc.weights) weights[String(w.userId)] = w.weight
  const out: BackendVoteConfig = { threshold: vc.threshold }
  if (Object.keys(weights).length) out.weights = weights
  return out
}

function voteConfigFromBackend(vc: BackendVoteConfig | undefined): VoteConfig | undefined {
  if (!vc) return undefined
  const weights = Object.entries(vc.weights ?? {}).map(([userId, weight]) => ({ userId: Number(userId), weight }))
  return { threshold: typeof vc.threshold === "number" ? vc.threshold : 0.5, weights }
}

function stepToBackend(step: StepNode, nodeProps: NodePropsMap): BackendNode {
  if (step.kind === "approval") {
    const props = nodeProps[step.id] ?? {}
    return {
      id: step.id,
      type: "approval",
      name: step.name,
      assigneeRules: (props.assigneeRules ?? []).map(ruleToBackend),
      multiMode: props.multiMode ?? "ANY",
      voteConfig: props.multiMode === "VOTE" ? voteConfigToBackend(props.voteConfig) : undefined,
      emptyStrategy: props.emptyStrategy ?? "TO_ADMIN",
      allowedOps: props.allowedOps,
      handleOptions: props.handleOptions,
      auditMenu: props.auditMenu,
      commentRequired: props.commentRequired,
      timeout: props.timeout,
      formPerms: props.formPerms,
      events: props.events,
    }
  }
  if (step.kind === "cc") {
    const props = nodeProps[step.id] ?? {}
    return {
      id: step.id,
      type: "cc",
      name: step.name,
      users: (props.ccUsers ?? []).map(orgRefToBackend),
    }
  }
  if (step.kind === "subprocess") {
    const paramMap: Record<string, string> = {}
    for (const p of step.paramMap) if (p.child) paramMap[p.child] = p.parent
    return { id: step.id, type: "subprocess", name: step.name, defCode: step.defCode, async: step.async, paramMap }
  }
  if (step.kind === "timer") {
    return { id: step.id, type: "timer", name: step.name, mode: step.mode, value: step.value }
  }
  if (step.kind === "trigger") {
    return {
      id: step.id,
      type: "trigger",
      name: step.name,
      triggerType: step.triggerType,
      handler: step.handler || undefined,
      webhookUrl: step.webhookUrl || undefined,
      timer: step.timer || undefined,
    }
  }
  if (step.kind === "ai") {
    return {
      id: step.id,
      type: "ai",
      name: step.name,
      model: step.model,
      systemPrompt: step.systemPrompt,
      formContext: step.formContext,
      outputMap: step.outputMap,
    }
  }
  if (step.kind === "autoApprove") {
    return { id: step.id, type: "autoApprove", name: step.name }
  }
  if (step.kind === "autoReject") {
    return { id: step.id, type: "autoReject", name: step.name }
  }
  // 分支容器：condition / inclusive / parallel（step 已收窄为 BranchContainerStep）
  const container: BranchContainerStep = step
  const isParallel = container.kind === "parallel"
  const branches: BackendBranch[] = container.branches.map((branch, index) => {
    // 并行分支无默认、无条件；条件/包容最后一条为默认（无条件）
    const isDefault = !isParallel && index === container.branches.length - 1
    const cond = nodeProps[branch.id]?.condition
    const backend: BackendBranch = {
      id: branch.id,
      name: branch.name,
      conditions:
        isParallel || isDefault
          ? []
          : (cond?.items ?? []).map((item) => ({
              field: item.field,
              operator: OP_TO_SYMBOL[item.operator],
              value: coerceValue(item.value),
            })),
      steps: branch.steps.map((s) => stepToBackend(s, nodeProps)),
    }
    if (isDefault) backend.default = true
    return backend
  })
  if (container.kind === "parallel") return { id: container.id, type: "parallel", name: container.name, branches }
  if (container.kind === "inclusive") return { id: container.id, type: "inclusive", name: container.name, branches }
  return { id: container.id, type: "condition", name: container.name, branches }
}

export function serializeDingtalk(
  steps: StepNode[],
  nodeProps: NodePropsMap,
  flowConfig?: FlowConfig,
): BackendDesignerJson {
  return { nodes: steps.map((s) => stepToBackend(s, nodeProps)), flowConfig }
}

/* ================= 反序列化：后端 {nodes} → 内部模型 ================= */

function backendToStep(node: BackendNode, nodeProps: NodePropsMap): StepNode {
  if (node.type === "approval") {
    const props: WfNodeProps = {
      assigneeRules: (node.assigneeRules ?? []).map(ruleFromBackend),
      multiMode: node.multiMode ?? "ANY",
      voteConfig: voteConfigFromBackend(node.voteConfig),
      emptyStrategy: node.emptyStrategy ?? "TO_ADMIN",
      allowedOps: node.allowedOps,
      handleOptions: node.handleOptions,
      auditMenu: node.auditMenu,
      commentRequired: node.commentRequired,
      timeout: node.timeout,
      formPerms: node.formPerms,
      events: node.events,
    }
    nodeProps[node.id] = props
    const step: ApprovalStep = {
      id: node.id,
      kind: "approval",
      name: node.name,
      assignees: [],
      mode: node.multiMode === "ALL" ? "all" : "any",
    }
    return step
  }
  if (node.type === "cc") {
    nodeProps[node.id] = {
      ccUsers: (node.users ?? []).map(backendToOrgRef),
    }
    const step: CcStep = { id: node.id, kind: "cc", name: node.name, users: [] }
    return step
  }
  if (node.type === "subprocess") {
    const paramMap = Object.entries(node.paramMap ?? {}).map(([child, parent]) => ({ child, parent }))
    const step: SubprocessStep = {
      id: node.id,
      kind: "subprocess",
      name: node.name,
      defCode: node.defCode ?? "",
      async: node.async ?? false,
      paramMap,
    }
    return step
  }
  if (node.type === "timer") {
    const step: TimerStep = {
      id: node.id,
      kind: "timer",
      name: node.name,
      mode: node.mode ?? "duration",
      value: node.value ?? "",
    }
    return step
  }
  if (node.type === "trigger") {
    const step: TriggerStep = {
      id: node.id,
      kind: "trigger",
      name: node.name,
      triggerType: node.triggerType ?? "IMMEDIATE",
      handler: node.handler ?? "",
      webhookUrl: node.webhookUrl ?? "",
      timer: node.timer ?? "",
    }
    return step
  }
  if (node.type === "ai") {
    const step: AiStep = {
      id: node.id,
      kind: "ai",
      name: node.name,
      model: node.model ?? "",
      systemPrompt: node.systemPrompt ?? "",
      formContext: node.formContext ?? [],
      outputMap: node.outputMap ?? { decision: "aiDecision", comment: "aiComment" },
    }
    return step
  }
  if (node.type === "autoApprove") {
    const step: AutoApproveStep = { id: node.id, kind: "autoApprove", name: node.name }
    return step
  }
  if (node.type === "autoReject") {
    const step: AutoRejectStep = { id: node.id, kind: "autoReject", name: node.name }
    return step
  }
  // 分支容器：condition / inclusive / parallel
  const isParallel = node.type === "parallel"
  const branches: Branch[] = (node.branches ?? []).map((branch, index, arr) => {
    const isDefault = !isParallel && (branch.default === true || index === arr.length - 1)
    const items: ConditionItem[] = (branch.conditions ?? []).map((c) => ({
      field: c.field,
      operator: SYMBOL_TO_OP[c.operator] ?? "eq",
      value: String(c.value ?? ""),
    }))
    if (!isParallel) nodeProps[branch.id] = { condition: { logic: "AND", items, isDefault } }
    return {
      id: branch.id,
      name: branch.name,
      condition: "",
      steps: (branch.steps ?? []).map((s) => backendToStep(s, nodeProps)),
    }
  })
  if (node.type === "parallel") return { id: node.id, kind: "parallel", name: node.name, branches }
  if (node.type === "inclusive") return { id: node.id, kind: "inclusive", name: node.name, branches }
  const step: BranchContainerStep = { id: node.id, kind: "condition", name: node.name, branches }
  return step
}

export function deserializeDingtalk(json: BackendDesignerJson): {
  steps: StepNode[]
  nodeProps: NodePropsMap
  flowConfig: FlowConfig
} {
  const nodeProps: NodePropsMap = {}
  const steps = (json.nodes ?? []).map((n) => backendToStep(n, nodeProps))
  const flowConfig: FlowConfig = { ...defaultFlowConfig(), ...(json.flowConfig ?? {}) }
  return { steps, nodeProps, flowConfig }
}

/** 判定一个已解析对象是否为后端格式（有 nodes 数组） */
export function isBackendDesignerJson(obj: unknown): obj is BackendDesignerJson {
  return !!obj && typeof obj === "object" && Array.isArray((obj as { nodes?: unknown }).nodes)
}
