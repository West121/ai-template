/**
 * 包容网关节点（BPMN inclusiveGateway）：紫色菱形 + ◯ 标记。
 * 满足的多条出边都走 + 默认出边（edge.isDefault）。
 */
import type { NodeProps } from "@xyflow/react"
import { Circle } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { GatewayShell } from "./node-chrome"

export function InclusiveGatewayNode({ data, selected }: NodeProps<WfRfNode>) {
  return (
    <GatewayShell
      icon={Circle}
      name={data.name}
      colorClass="border-violet-500 bg-violet-500/10"
      iconClass="text-violet-600 dark:text-violet-400"
      handleColor="!bg-violet-500"
      selected={selected}
    />
  )
}
