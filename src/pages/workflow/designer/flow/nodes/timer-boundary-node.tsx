/**
 * 边界定时事件（BPMN boundaryEvent + timerEventDefinition），附着在某活动上。
 * 中断型（cancelActivity=true）用实线双圈；非中断型用虚线双圈（BPMN 惯例）。
 * 附着关系走 data.attachedTo（不走 edge）；仅出边（source），无入边。
 * 本切片以自由摆放的小节点承载 attachedTo，视觉贴附宿主推迟到后续切片。
 */
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { AlarmClock } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WfRfNode } from "../serialize"
import { summarizeTimer } from "../summary"
import { NodeLabel, handleClass, selectedRing } from "./node-chrome"

export function TimerBoundaryNode({ data, selected }: NodeProps<WfRfNode>) {
  const interrupting = data.cancelActivity ?? true
  return (
    <div className="relative size-11">
      <div
        className={cn(
          "flex size-11 items-center justify-center rounded-full border-2 bg-background shadow-sm",
          interrupting ? "border-rose-500" : "border-rose-500 border-dashed",
          selectedRing(selected),
        )}
      >
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-full border text-rose-600 dark:text-rose-400",
            interrupting ? "border-rose-500/70" : "border-dashed border-rose-500/70",
          )}
        >
          <AlarmClock className="size-3.5" />
        </div>
      </div>
      <NodeLabel>
        {data.name}
        <span className="block text-[10px] font-normal text-muted-foreground">
          {interrupting ? "中断" : "非中断"} · {summarizeTimer(data.timer)}
        </span>
      </NodeLabel>
      <Handle type="source" position={Position.Bottom} className={handleClass("!bg-rose-500")} />
    </div>
  )
}
