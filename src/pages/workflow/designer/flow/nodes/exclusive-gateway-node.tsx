/**
 * 排它网关节点（BPMN exclusiveGateway）：琥珀色菱形 + X 标记。
 * 命中优先级最高的一条出边；默认出边由 edge.isDefault 标记（在边上展示）。
 */
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WfRfNode } from "../serialize"
import { NodeLabel, handleClass, selectedRing } from "./node-chrome"

export function ExclusiveGatewayNode({ data, selected }: NodeProps<WfRfNode>) {
  return (
    <div className="relative size-12">
      <div
        className={cn(
          "flex size-12 rotate-45 items-center justify-center rounded-md border-2 border-amber-500 bg-amber-500/10 shadow-sm",
          selectedRing(selected),
        )}
      >
        <X className="size-4 -rotate-45 text-amber-600 dark:text-amber-400" />
      </div>
      <NodeLabel>{data.name}</NodeLabel>
      <Handle type="target" position={Position.Top} className={handleClass("!bg-amber-500")} />
      <Handle type="source" position={Position.Bottom} className={handleClass("!bg-amber-500")} />
      <Handle id="right" type="source" position={Position.Right} className={handleClass("!bg-amber-500")} />
    </div>
  )
}
