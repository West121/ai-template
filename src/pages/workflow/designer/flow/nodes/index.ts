/**
 * 切片 1 核心自定义节点注册表：nodeTypes 的 key 与 model.ts 的 FlowNodeType 判别键一致，
 * 使 react-flow `node.type` 可直接被 serialize 消费，无需额外映射。
 */
import type { NodeTypes } from "@xyflow/react"
import { ApprovalNode } from "./approval-node"
import { EndEventNode } from "./end-event-node"
import { ExclusiveGatewayNode } from "./exclusive-gateway-node"
import { StartEventNode } from "./start-event-node"

export const nodeTypes: NodeTypes = {
  startEvent: StartEventNode,
  endEvent: EndEventNode,
  userTask: ApprovalNode,
  exclusiveGateway: ExclusiveGatewayNode,
}

export { ApprovalNode, EndEventNode, ExclusiveGatewayNode, StartEventNode }
