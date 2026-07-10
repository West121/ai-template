/**
 * 起始事件节点（BPMN startEvent）：绿色细圈，仅出边（source）。
 */
import type { NodeProps } from "@xyflow/react"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WfRfNode } from "../serialize"
import { NodeHandles, NodeLabel, NodeToolbarActions, nodeRing } from "./node-chrome"

export function StartEventNode({ id, data, selected }: NodeProps<WfRfNode>) {
  return (
    <div className="group relative size-12">
      <NodeToolbarActions id={id} />
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full border-2 border-emerald-500 bg-emerald-500/10 text-emerald-600 shadow-sm dark:text-emerald-400",
          nodeRing(selected, data.validation, data.highlight),
        )}
      >
        <Play className="size-4 fill-current" />
      </div>
      <NodeLabel>{data.name}</NodeLabel>
      <NodeHandles color="!bg-emerald-500" />
    </div>
  )
}
