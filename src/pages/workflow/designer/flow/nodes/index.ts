/**
 * 自定义节点注册表：nodeTypes 的 key 与 model.ts 的 FlowNodeType 判别键一致，
 * 使 react-flow `node.type` 可直接被 serialize 消费，无需额外映射。
 * 切片 2：覆盖 model.ts 全部 14 类 FlowNodeType。
 */
import type { NodeTypes } from "@xyflow/react"
import { AiNode } from "./ai-node"
import { ApprovalNode } from "./approval-node"
import { CallActivityNode } from "./call-activity-node"
import { CcNode } from "./cc-node"
import { EndEventNode } from "./end-event-node"
import { ExclusiveGatewayNode } from "./exclusive-gateway-node"
import { InclusiveGatewayNode } from "./inclusive-gateway-node"
import { ParallelGatewayNode } from "./parallel-gateway-node"
import { ServiceTaskNode } from "./service-task-node"
import { StartEventNode } from "./start-event-node"
import { SubProcessNode } from "./sub-process-node"
import { TimerBoundaryNode } from "./timer-boundary-node"
import { TimerCatchNode } from "./timer-catch-node"
import { WebhookNode } from "./webhook-node"

export const nodeTypes: NodeTypes = {
  startEvent: StartEventNode,
  endEvent: EndEventNode,
  userTask: ApprovalNode,
  serviceTask: ServiceTaskNode,
  exclusiveGateway: ExclusiveGatewayNode,
  parallelGateway: ParallelGatewayNode,
  inclusiveGateway: InclusiveGatewayNode,
  callActivity: CallActivityNode,
  subProcess: SubProcessNode,
  timerCatch: TimerCatchNode,
  timerBoundary: TimerBoundaryNode,
  cc: CcNode,
  ai: AiNode,
  webhook: WebhookNode,
}

export {
  AiNode,
  ApprovalNode,
  CallActivityNode,
  CcNode,
  EndEventNode,
  ExclusiveGatewayNode,
  InclusiveGatewayNode,
  ParallelGatewayNode,
  ServiceTaskNode,
  StartEventNode,
  SubProcessNode,
  TimerBoundaryNode,
  TimerCatchNode,
  WebhookNode,
}
