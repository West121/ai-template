/**
 * OrchModel ⇄ react-flow 画布状态双向序列化（纯数据转换，node 可测）。
 *
 * react-flow 侧：`node.type` 复用 OrchNodeType 判别键；领域数据挂 `node.data`
 * （name + config），边条件挂 `edge.data`。往返无损（serialize.test.ts 锁定）。
 */
import type { Edge, Node } from "@xyflow/react"
import type { BranchCondition } from "@/pages/workflow/designer/types"
import type { OrchEdge, OrchModel, OrchNode, OrchNodeConfig, OrchNodeType } from "./model"

export interface OrchNodeData extends Record<string, unknown> {
  name: string
  config: OrchNodeConfig
  /** 瞬态（校验高亮/执行态），不序列化 */
  validation?: "error" | "warning"
  execStatus?: OrchExecNodeStatus
}

/** 节点执行态（测试运行回放 / 执行详情共用） */
export type OrchExecNodeStatus = "RUNNING" | "WAITING" | "SUCCESS" | "FAILED" | "SKIPPED"

export interface OrchEdgeData extends Record<string, unknown> {
  condition?: BranchCondition
  expression?: string
  isDefault?: boolean
  /** loop 出边：循环体入口标记（图契约，见 model.ts OrchEdge.loopBody） */
  loopBody?: boolean
  /** onError=BRANCH 出边：失败分支标记 */
  errorBranch?: boolean
}

export type OrchRfNode = Node<OrchNodeData>
export type OrchRfEdge = Edge<OrchEdgeData>

export const ORCH_EDGE_TYPE = "orchEdge"

export interface OrchMeta {
  key: string
  name: string
}

/** 画布 → OrchModel */
export function toOrchModel(nodes: OrchRfNode[], edges: OrchRfEdge[], meta: OrchMeta): OrchModel {
  return {
    schemaVersion: 1,
    key: meta.key,
    name: meta.name,
    nodes: nodes.map((n): OrchNode => ({
      id: n.id,
      type: (n.type ?? "http") as OrchNodeType,
      name: n.data.name,
      position: { x: n.position.x, y: n.position.y },
      config: n.data.config,
    })),
    edges: edges.map((e): OrchEdge => {
      const out: OrchEdge = { id: e.id, source: e.source, target: e.target }
      if (e.data?.condition) out.condition = e.data.condition
      if (e.data?.expression !== undefined) out.expression = e.data.expression
      if (e.data?.isDefault) out.isDefault = true
      if (e.data?.loopBody) out.loopBody = true
      if (e.data?.errorBranch) out.errorBranch = true
      return out
    }),
  }
}

/** OrchModel → 画布 */
export function fromOrchModel(model: OrchModel): { nodes: OrchRfNode[]; edges: OrchRfEdge[] } {
  return {
    // position 兜底：API 直建的流(如 smoke/脚本)节点可能缺坐标——缺省按序竖排,
    // 避免 n.position.x 崩整页白屏(载入后可用「整理」一键布局)。
    nodes: model.nodes.map((n, i): OrchRfNode => ({
      id: n.id,
      type: n.type,
      position: { x: n.position?.x ?? 80, y: n.position?.y ?? 60 + i * 110 },
      data: { name: n.name, config: n.config },
    })),
    edges: model.edges.map((e): OrchRfEdge => {
      const data: OrchEdgeData = {}
      if (e.condition) data.condition = e.condition
      if (e.expression !== undefined) data.expression = e.expression
      if (e.isDefault) data.isDefault = true
      if (e.loopBody) data.loopBody = true
      if (e.errorBranch) data.errorBranch = true
      return { id: e.id, source: e.source, target: e.target, type: ORCH_EDGE_TYPE, data }
    }),
  }
}

/** 解析存储的 designerJson（字符串或对象）；非法/空返回 null */
export function parseOrchModel(raw: unknown): OrchModel | null {
  if (raw == null) return null
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    if (obj && typeof obj === "object" && Array.isArray((obj as { nodes?: unknown }).nodes)) {
      return obj as OrchModel
    }
    return null
  } catch {
    return null
  }
}
