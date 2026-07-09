/**
 * 并行网关节点（BPMN parallelGateway）：琥珀色菱形 + ＋ 标记（裁定 A1 三网关统一 amber）。
 * fork 无条件全激活 / join 全部到达汇聚；出边不带条件（校验器拦截带条件的并行出边）。
 */
import type { NodeProps } from "@xyflow/react"
import { Plus } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { GatewayShell } from "./node-chrome"

export function ParallelGatewayNode({ id, data, selected }: NodeProps<WfRfNode>) {
  return (
    <GatewayShell
      id={id}
      icon={Plus}
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
