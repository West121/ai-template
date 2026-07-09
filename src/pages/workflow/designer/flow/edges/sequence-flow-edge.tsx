/**
 * 顺序流边（BPMN sequenceFlow）：平滑折线 + 中点标签。
 *  - 有结构化 condition / 高级 expression 时展示条件摘要；
 *  - isDefault 时展示「默认」标记（斜杠符号语义）。
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react"
import { cn } from "@/lib/utils"
import type { WfEdgeData } from "../serialize"
import { summarizeCondition } from "../summary"

export function SequenceFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition: sourcePosition ?? Position.Bottom,
    targetX,
    targetY,
    targetPosition: targetPosition ?? Position.Top,
    borderRadius: 8,
  })

  const d = data as WfEdgeData | undefined
  const isDefault = d?.isDefault ?? false
  const summary = d?.expression?.trim() ? d.expression.trim() : summarizeCondition(d?.condition, isDefault)
  const label = isDefault ? "默认" : summary

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ strokeWidth: selected ? 2 : 1.5 }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn(
              "pointer-events-none absolute max-w-40 truncate rounded border bg-background px-1.5 py-0.5 text-[11px] shadow-sm",
              isDefault
                ? "border-slate-400/50 text-muted-foreground"
                : "border-amber-500/40 text-amber-600 dark:text-amber-400",
            )}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
