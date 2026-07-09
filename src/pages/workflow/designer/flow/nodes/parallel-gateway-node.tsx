/**
 * 并行网关节点（BPMN parallelGateway）：蓝色菱形 + ＋ 标记。
 * fork 无条件全激活 / join 全部到达汇聚；出边不带条件（校验器拦截带条件的并行出边）。
 */
import type { NodeProps } from "@xyflow/react"
import { Plus } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { GatewayShell } from "./node-chrome"

export function ParallelGatewayNode({ data, selected }: NodeProps<WfRfNode>) {
  return (
    <GatewayShell
      icon={Plus}
      name={data.name}
      colorClass="border-sky-500 bg-sky-500/10"
      iconClass="text-sky-600 dark:text-sky-400"
      handleColor="!bg-sky-500"
      selected={selected}
    />
  )
}
