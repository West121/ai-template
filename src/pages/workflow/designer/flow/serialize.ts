/**
 * 归一化模型 `ProcessModel` ⇄ react-flow(@xyflow/react) 画布状态 双向序列化。
 *
 * 本文件是「画布层」与「契约层」之间的唯一桥梁，**纯数据转换、无 React 运行时依赖**
 * （仅 `import type`，便于独立单测 / node 直跑）。严格遵循 model.ts 契约：
 *  - 节点：id / name / position / size? / props?（+ 各类节点专属 config，见下）
 *  - 边  ：id / source / target / name? / waypoints? / isDefault? / condition? / expression?
 *
 * react-flow 侧把领域数据挂在 `node.data`（WfNodeData）与 `edge.data`（WfEdgeData）：
 *  - `node.type` 直接复用 `FlowNodeType` 判别键（startEvent/userTask/serviceTask/...）。
 *  - `WfNodeProps` 原样挂 `node.data.props`，供共享 PropertyPanel 读写。
 *  - 节点专属 config（serviceTask.service / callActivity / subProcess.children / timer /
 *    ai / webhook / timerBoundary.attachedTo）挂在同名 `node.data.*` 字段，往返无损。
 *
 * 切片 2：`toProcessModel` / `fromProcessModel` 覆盖 model.ts 全部 14 类 FlowNodeType。
 *
 * 禁 any；类型导入一律 `import type`（verbatimModuleSyntax）。
 */
import type { Edge, Node } from "@xyflow/react"
import type { BranchCondition, WfNodeProps } from "../types"
import type { FlowConfig } from "../shared/config"
import type { NodeHighlightState } from "./nodes/node-chrome"
import type {
  AiConfig,
  CallActivityConfig,
  FlowNode,
  FlowNodeType,
  Point,
  ProcessModel,
  ScriptConfig,
  SequenceFlow,
  ServiceTaskConfig,
  Size,
  TimerConfig,
  WebhookConfig,
} from "./model"

/* ============================================================
 * react-flow 侧数据形状
 * ============================================================ */

/** 嵌入式子流程内联子图（对应 SubProcessNode.children） */
export interface SubGraph {
  nodes: FlowNode[]
  edges: SequenceFlow[]
}

/** 校验态（仅 UI 高亮用，绝不序列化进 ProcessModel；见 flow-designer 装饰逻辑） */
export type WfValidationState = "error" | "warning"

/** 挂在 react-flow `node.data` 的领域数据（审批域一律走 props，复用 WfNodeProps） */
export interface WfNodeData extends Record<string, unknown> {
  /** 节点显示名（对应 FlowNode.name） */
  name: string
  /**
   * 校验高亮态（**瞬态、仅渲染用**）：由 flow-designer 据 validateProcessModel 结果注入到
   * 展示副本的 data 上，node 组件读取加错误/警告环。toProcessModel 只拷贝已知领域字段，
   * 故此字段永不进入序列化结果（跨端无污染）。
   */
  validation?: WfValidationState
  /**
   * 运行时跟踪高亮态（**瞬态、仅渲染用**）：由只读 FlowViewer 据 WfHighlight 注入，
   * completed=已完成路径、active=当前节点。同 validation，toProcessModel 不拷贝，永不序列化。
   */
  highlight?: NodeHighlightState
  /** 审批域属性，共享 PropertyPanel 原样消费（对应 FlowNode.props） */
  props?: WfNodeProps
  /** 尺寸；省略时后端按类型给默认（对应 FlowNode.size） */
  size?: Size
  /** endEvent 专属：terminate 型（整实例终止） */
  terminate?: boolean
  /** userTask 专属：覆盖流程级 formKey */
  formKey?: string
  /** serviceTask 专属：实现判别（autoApprove/autoReject/trigger/delegate/script） */
  service?: ServiceTaskConfig
  /** serviceTask 专属：脚本任务体（仅 service.impl==="script" 有意义，对齐后端 FlowNodeDto.script） */
  script?: ScriptConfig
  /** callActivity 专属：子流程调用配置 */
  callActivity?: CallActivityConfig
  /** subProcess 专属：内联子图 */
  children?: SubGraph
  /** timerCatch / timerBoundary 专属：定时配置 */
  timer?: TimerConfig
  /** timerBoundary 专属：宿主活动节点 id */
  attachedTo?: string
  /** timerBoundary 专属：是否中断宿主（默认 true） */
  cancelActivity?: boolean
  /** ai 专属：AI 审批配置 */
  ai?: AiConfig
  /** webhook 专属：回调配置 */
  webhook?: WebhookConfig
}

/** 挂在 react-flow `edge.data` 的领域数据（对应 SequenceFlow 的可选字段） */
export interface WfEdgeData extends Record<string, unknown> {
  name?: string
  waypoints?: Point[]
  isDefault?: boolean
  condition?: BranchCondition
  expression?: string
  /** 校验高亮态（瞬态、仅渲染用，不序列化；同 WfNodeData.validation） */
  validation?: WfValidationState
  /** 运行时跟踪高亮态（瞬态、仅渲染用，不序列化；只读 FlowViewer 注入，同 WfNodeData.highlight） */
  highlight?: NodeHighlightState
}

export type WfRfNode = Node<WfNodeData>
export type WfRfEdge = Edge<WfEdgeData>

/** react-flow 自定义边类型键（见 edges/index.ts） */
export const SEQUENCE_FLOW_EDGE_TYPE = "sequenceFlow"

/** 流程元信息（不在画布 node/edge 内，由页面单独持有） */
export interface ProcessMeta {
  key: string
  name: string
  version?: number
  formKey?: string
  flowConfig?: FlowConfig
}

const DEFAULT_META: ProcessMeta = { key: "process", name: "未命名流程" }

/* ============================================================
 * 缺省 config 兜底（round-trip 时 model 必带；此处仅防御非法态）
 * ============================================================ */

const DEFAULT_SERVICE: ServiceTaskConfig = { impl: "delegate", delegateExpression: "" }
const DEFAULT_CALL_ACTIVITY: CallActivityConfig = { calledElement: "", async: false, paramMap: [] }
const DEFAULT_TIMER: TimerConfig = { mode: "duration", value: "" }
const DEFAULT_AI: AiConfig = {
  model: "",
  systemPrompt: "",
  formContext: [],
  outputMap: { decision: "", comment: "" },
}
const DEFAULT_WEBHOOK: WebhookConfig = { url: "" }

/* ============================================================
 * 画布状态 → ProcessModel
 * ============================================================ */

/** react-flow 节点/边 → 归一化 `ProcessModel`（严格按 model.ts 契约） */
export function toProcessModel(
  nodes: WfRfNode[],
  edges: WfRfEdge[],
  meta: ProcessMeta = DEFAULT_META,
): ProcessModel {
  const model: ProcessModel = {
    schemaVersion: 1,
    key: meta.key,
    name: meta.name,
    nodes: nodes.map(rfNodeToFlowNode),
    edges: edges.map(rfEdgeToSequenceFlow),
  }
  if (meta.version !== undefined) model.version = meta.version
  if (meta.formKey !== undefined) model.formKey = meta.formKey
  if (meta.flowConfig) model.flowConfig = meta.flowConfig
  return model
}

function rfNodeToFlowNode(node: WfRfNode): FlowNode {
  const type = node.type as FlowNodeType | undefined
  const base = {
    id: node.id,
    name: node.data.name,
    position: { x: node.position.x, y: node.position.y },
  } satisfies { id: string; name: string; position: Point }

  const common: { size?: Size; props?: WfNodeProps } = {}
  if (node.data.size) common.size = node.data.size
  if (node.data.props) common.props = node.data.props

  const d = node.data

  switch (type) {
    case "startEvent":
      return { ...base, ...common, type: "startEvent" }
    case "endEvent": {
      const end: FlowNode = { ...base, ...common, type: "endEvent" }
      if (d.terminate) end.terminate = true
      return end
    }
    case "userTask": {
      const task: FlowNode = { ...base, ...common, type: "userTask" }
      if (d.formKey !== undefined) task.formKey = d.formKey
      return task
    }
    case "serviceTask": {
      const svc: FlowNode = { ...base, ...common, type: "serviceTask", service: d.service ?? DEFAULT_SERVICE }
      // 脚本体仅在脚本任务模式携带，避免非 script 任务残留 script 字段（跨端字节一致）
      if (svc.service.impl === "script" && d.script) svc.script = d.script
      return svc
    }
    case "exclusiveGateway":
      return { ...base, ...common, type: "exclusiveGateway" }
    case "parallelGateway":
      return { ...base, ...common, type: "parallelGateway" }
    case "inclusiveGateway":
      return { ...base, ...common, type: "inclusiveGateway" }
    case "callActivity":
      return { ...base, ...common, type: "callActivity", callActivity: d.callActivity ?? DEFAULT_CALL_ACTIVITY }
    case "subProcess":
      return { ...base, ...common, type: "subProcess", children: d.children ?? { nodes: [], edges: [] } }
    case "timerCatch":
      return { ...base, ...common, type: "timerCatch", timer: d.timer ?? DEFAULT_TIMER }
    case "timerBoundary": {
      const boundary: FlowNode = {
        ...base,
        ...common,
        type: "timerBoundary",
        timer: d.timer ?? DEFAULT_TIMER,
        attachedTo: d.attachedTo ?? "",
      }
      if (d.cancelActivity !== undefined) boundary.cancelActivity = d.cancelActivity
      return boundary
    }
    case "cc":
      return { ...base, ...common, type: "cc" }
    case "ai":
      return { ...base, ...common, type: "ai", ai: d.ai ?? DEFAULT_AI }
    case "webhook":
      return { ...base, ...common, type: "webhook", webhook: d.webhook ?? DEFAULT_WEBHOOK }
    default:
      throw new Error(`toProcessModel：未知节点类型「${String(type)}」`)
  }
}

function rfEdgeToSequenceFlow(edge: WfRfEdge): SequenceFlow {
  const d = edge.data
  const flow: SequenceFlow = { id: edge.id, source: edge.source, target: edge.target }
  if (d?.name !== undefined) flow.name = d.name
  if (d?.waypoints) flow.waypoints = d.waypoints
  if (d?.isDefault) flow.isDefault = true
  if (d?.condition) flow.condition = d.condition
  if (d?.expression !== undefined) flow.expression = d.expression
  return flow
}

/* ============================================================
 * ProcessModel → 画布状态
 * ============================================================ */

/** 归一化 `ProcessModel` → react-flow 节点/边（画布消费） */
export function fromProcessModel(pm: ProcessModel): { nodes: WfRfNode[]; edges: WfRfEdge[] } {
  return {
    nodes: pm.nodes.map(flowNodeToRfNode),
    edges: pm.edges.map(sequenceFlowToRfEdge),
  }
}

function flowNodeToRfNode(node: FlowNode): WfRfNode {
  const data: WfNodeData = { name: node.name }
  if (node.props) data.props = node.props
  if (node.size) data.size = node.size

  switch (node.type) {
    case "endEvent":
      if (node.terminate) data.terminate = true
      break
    case "userTask":
      if (node.formKey !== undefined) data.formKey = node.formKey
      break
    case "serviceTask":
      data.service = node.service
      if (node.script) data.script = node.script
      break
    case "callActivity":
      data.callActivity = node.callActivity
      break
    case "subProcess":
      data.children = node.children
      break
    case "timerCatch":
      data.timer = node.timer
      break
    case "timerBoundary":
      data.timer = node.timer
      data.attachedTo = node.attachedTo
      if (node.cancelActivity !== undefined) data.cancelActivity = node.cancelActivity
      break
    case "ai":
      data.ai = node.ai
      break
    case "webhook":
      data.webhook = node.webhook
      break
    default:
      break
  }

  return {
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    data,
  }
}

function sequenceFlowToRfEdge(edge: SequenceFlow): WfRfEdge {
  const data: WfEdgeData = {}
  if (edge.name !== undefined) data.name = edge.name
  if (edge.waypoints) data.waypoints = edge.waypoints
  if (edge.isDefault) data.isDefault = true
  if (edge.condition) data.condition = edge.condition
  if (edge.expression !== undefined) data.expression = edge.expression
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: SEQUENCE_FLOW_EDGE_TYPE,
    data,
  }
}
