/**
 * 起始事件节点（BPMN startEvent）：绿色细圈，仅出边（source）。
 */
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WfRfNode } from "../serialize"
import { NodeLabel, handleClass, selectedRing } from "./node-chrome"

export function StartEventNode({ data, selected }: NodeProps<WfRfNode>) {
  return (
    <div className="relative size-12">
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full border-2 border-emerald-500 bg-emerald-500/10 text-emerald-600 shadow-sm dark:text-emerald-400",
          selectedRing(selected),
        )}
      >
        <Play className="size-4 fill-current" />
      </div>
      <NodeLabel>{data.name}</NodeLabel>
      <Handle type="source" position={Position.Bottom} className={handleClass("!bg-emerald-500")} />
    </div>
  )
}
