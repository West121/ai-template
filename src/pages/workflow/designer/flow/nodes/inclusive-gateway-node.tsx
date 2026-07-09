/**
 * 包容网关节点（BPMN inclusiveGateway）：琥珀色菱形 + ◯（CircleDot）标记（裁定 A1 三网关统一 amber）。
 * 满足的多条出边都走 + 默认出边（edge.isDefault）。
 */
import type { NodeProps } from "@xyflow/react"
import { CircleDot } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { GatewayShell } from "./node-chrome"

export function InclusiveGatewayNode({ id, data, selected }: NodeProps<WfRfNode>) {
  return (
    <GatewayShell
      id={id}
      icon={CircleDot}
      name={data.name}
      colorClass="border-amber-500 bg-amber-500/10"
      iconClass="text-amber-600 dark:text-amber-400"
      handleColor="!bg-amber-500"
      selected={selected}
      validation={data.validation}
      highlight={data.highlight}
    />
  )
}
