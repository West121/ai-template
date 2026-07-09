/**
 * 中间捕获定时事件（BPMN intermediateCatchEvent + timerEventDefinition）：
 * 双圈圆形 + 时钟图标（BPMN 中间事件"双细圈"语义）。入/出边俱全，到点进入下一步。
 */
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WfRfNode } from "../serialize"
import { summarizeTimer } from "../summary"
import { NodeLabel, NodeToolbarActions, handleClass, nodeRing } from "./node-chrome"

export function TimerCatchNode({ id, data, selected }: NodeProps<WfRfNode>) {
  return (
    <div className="relative size-12">
      <NodeToolbarActions id={id} />
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full border-2 border-indigo-500 bg-indigo-500/10 shadow-sm",
          nodeRing(selected, data.validation, data.highlight),
        )}
      >
        {/* 内圈：中间事件双圈语义 */}
        <div className="flex size-9 items-center justify-center rounded-full border border-indigo-500/70 text-indigo-600 dark:text-indigo-400">
          <Clock className="size-4" />
        </div>
      </div>
      <NodeLabel>
        {data.name}
        <span className="block text-[10px] font-normal text-muted-foreground">{summarizeTimer(data.timer)}</span>
      </NodeLabel>
      <Handle type="target" position={Position.Top} className={handleClass("!bg-indigo-500")} />
      <Handle type="source" position={Position.Bottom} className={handleClass("!bg-indigo-500")} />
    </div>
  )
}
