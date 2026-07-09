/**
 * 排它网关节点（BPMN exclusiveGateway）：琥珀色菱形 + X 标记。
 * 命中优先级最高的一条出边；默认出边由 edge.isDefault 标记（在边上展示）。
 */
import type { NodeProps } from "@xyflow/react"
import { X } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { GatewayShell } from "./node-chrome"

export function ExclusiveGatewayNode({ data, selected }: NodeProps<WfRfNode>) {
  return (
    <GatewayShell
      icon={X}
      name={data.name}
      colorClass="border-amber-500 bg-amber-500/10"
      iconClass="text-amber-600 dark:text-amber-400"
      handleColor="!bg-amber-500"
      selected={selected}
    />
  )
}
