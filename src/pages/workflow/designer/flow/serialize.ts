/**
 * 归一化模型 `ProcessModel` ⇄ react-flow(@xyflow/react) 画布状态 双向序列化（切片 1）。
 *
 * 本文件是「画布层」与「契约层」之间的唯一桥梁，**纯数据转换、无 React 运行时依赖**
 * （仅 `import type`，便于独立单测 / node 直跑）。严格遵循 model.ts 契约：
 *  - 节点：id / name / position / size? / props?（+ endEvent.terminate、userTask.formKey）
 *  - 边  ：id / source / target / name? / waypoints? / isDefault? / condition? / expression?
 *
 * react-flow 侧把领域数据挂在 `node.data`（WfNodeData）与 `edge.data`（WfEdgeData）：
 *  - `node.type` 直接复用 `FlowNodeType` 判别键（startEvent/userTask/exclusiveGateway/endEvent…）。
 *  - `WfNodeProps` 原样挂 `node.data.props`，供共享 PropertyPanel 读写。
 *
 * 切片 1 仅落地 4 类核心节点的 `toProcessModel`（其余类型抛错，待后续切片补齐）；
 * `fromProcessModel` 已按契约对全部节点类型透传（画布暂只渲染 4 类）。
 *
 * 禁 any；类型导入一律 `import type`（verbatimModuleSyntax）。
 */
import type { Edge, Node } from "@xyflow/react"
import type { BranchCondition, WfNodeProps } from "../types"
import type { FlowConfig } from "../shared/config"
import type { FlowNode, FlowNodeType, Point, ProcessModel, SequenceFlow, Size } from "./model"

/* ============================================================
 * react-flow 侧数据形状
 * ============================================================ */

/** 挂在 react-flow `node.data` 的领域数据（审批域一律走 props，复用 WfNodeProps） */
export interface WfNodeData extends Record<string, unknown> {
  /** 节点显示名（对应 FlowNode.name） */
  name: string
  /** 审批域属性，共享 PropertyPanel 原样消费（对应 FlowNode.props） */
  props?: WfNodeProps
  /** 尺寸；省略时后端按类型给默认（对应 FlowNode.size） */
  size?: Size
  /** endEvent 专属：terminate 型（整实例终止） */
  terminate?: boolean
  /** userTask 专属：覆盖流程级 formKey */
  formKey?: string
}

/** 挂在 react-flow `edge.data` 的领域数据（对应 SequenceFlow 的可选字段） */
export interface WfEdgeData extends Record<string, unknown> {
  name?: string
  waypoints?: Point[]
  isDefault?: boolean
  condition?: BranchCondition
  expression?: string
}

export type WfRfNode = Node<WfNodeData>
export type WfRfEdge = Edge<WfEdgeData>

/** react-flow 自定义边类型键（见 edges/index.ts） */
export const SEQUENCE_FLOW_EDGE_TYPE = "sequenceFlow"

/** 本切片画布已渲染的节点类型 */
const SUPPORTED_NODE_TYPES: readonly FlowNodeType[] = [
  "startEvent",
  "endEvent",
  "userTask",
  "exclusiveGateway",
]

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

  switch (type) {
    case "startEvent":
      return { ...base, ...common, type: "startEvent" }
    case "endEvent": {
      const end: FlowNode = { ...base, ...common, type: "endEvent" }
      if (node.data.terminate) end.terminate = true
      return end
    }
    case "userTask": {
      const task: FlowNode = { ...base, ...common, type: "userTask" }
      if (node.data.formKey !== undefined) task.formKey = node.data.formKey
      return task
    }
    case "exclusiveGateway":
      return { ...base, ...common, type: "exclusiveGateway" }
    default:
      throw new Error(
        `toProcessModel：切片 1 暂不支持节点类型「${String(type)}」，仅支持 ${SUPPORTED_NODE_TYPES.join(" / ")}`,
      )
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
  if (node.type === "endEvent" && node.terminate) data.terminate = true
  if (node.type === "userTask" && node.formKey !== undefined) data.formKey = node.formKey
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
