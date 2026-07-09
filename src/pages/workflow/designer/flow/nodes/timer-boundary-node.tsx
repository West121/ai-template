/**
 * 边界定时事件（BPMN boundaryEvent + timerEventDefinition），附着在某活动上。
 * 中断型（cancelActivity=true）用实线双圈；非中断型用虚线双圈（BPMN 惯例）。
 * 附着关系走 data.attachedTo（不走 edge）；仅出边（source），无入边。
 * 配色归入「结构/定时」indigo 家族（rose 归还异常语义），本切片自由摆放，贴附宿主推迟。
 */
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { AlarmClock } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WfRfNode } from "../serialize"
import { summarizeTimer } from "../summary"
import { NodeLabel, NodeToolbarActions, handleClass, nodeRing } from "./node-chrome"

export function TimerBoundaryNode({ id, data, selected }: NodeProps<WfRfNode>) {
  const interrupting = data.cancelActivity ?? true
  return (
    <div className="relative size-12">
      <NodeToolbarActions id={id} />
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full border-2 bg-background shadow-sm",
          interrupting ? "border-indigo-500" : "border-indigo-500 border-dashed",
          nodeRing(selected, data.validation),
        )}
      >
        <div
          className={cn(
            "flex size-9 items-center justify-center rounded-full border text-indigo-600 dark:text-indigo-400",
            interrupting ? "border-indigo-500/70" : "border-dashed border-indigo-500/70",
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
      <Handle type="source" position={Position.Bottom} className={handleClass("!bg-indigo-500")} />
    </div>
  )
}
