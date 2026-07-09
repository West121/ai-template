/**
 * 结束事件节点（BPMN endEvent）：粗圈，仅入边（target）。
 * terminate 型（整实例终止）用玫红配色 + 方形标记以示区分。
 */
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Circle, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WfRfNode } from "../serialize"
import { NodeLabel, NodeToolbarActions, handleClass, nodeRing } from "./node-chrome"

export function EndEventNode({ id, data, selected }: NodeProps<WfRfNode>) {
  const terminate = data.terminate ?? false
  return (
    <div className="relative size-12">
      <NodeToolbarActions id={id} />
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full border-[3px] shadow-sm",
          terminate
            ? "border-rose-600 bg-rose-500/10 text-rose-600 dark:text-rose-400"
            : "border-slate-500 bg-slate-500/10 text-slate-600 dark:text-slate-300",
          nodeRing(selected, data.validation),
        )}
      >
        {terminate ? <Square className="size-3.5 fill-current" /> : <Circle className="size-3.5 fill-current" />}
      </div>
      <NodeLabel>
        {data.name}
        {terminate && <span className="text-rose-500"> · 终止</span>}
      </NodeLabel>
      <Handle type="target" position={Position.Top} className={handleClass("!bg-slate-500")} />
    </div>
  )
}
