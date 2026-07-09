/**
 * 自定义边注册表：key 与 serialize.ts 的 SEQUENCE_FLOW_EDGE_TYPE 一致。
 */
import type { EdgeTypes } from "@xyflow/react"
import { SEQUENCE_FLOW_EDGE_TYPE } from "../serialize"
import { SequenceFlowEdge } from "./sequence-flow-edge"

export const edgeTypes: EdgeTypes = {
  [SEQUENCE_FLOW_EDGE_TYPE]: SequenceFlowEdge,
}

export { SequenceFlowEdge }
