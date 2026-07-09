/**
 * 顺序流边（BPMN sequenceFlow）：平滑折线 + 中点标签。
 *  - 有结构化 condition / 高级 expression 时展示条件摘要（字段显示表单 label，W-07）；
 *  - isDefault 时展示「默认」标记；
 *  - 选中时描边走 `--primary` 加粗（W-10）；校验错误时描边走 `--destructive`（W-14）。
 */
import { useContext, useMemo } from "react"
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
import { FormFieldsContext } from "../nodes/node-chrome"

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

  const fields = useContext(FormFieldsContext)
  const fieldLabel = useMemo(() => {
    const map = new Map(fields.map((f) => [f.key, f.label]))
    return (key: string) => map.get(key) ?? key
  }, [fields])

  const d = data as WfEdgeData | undefined
  const isDefault = d?.isDefault ?? false
  const isError = d?.validation === "error"
  const summary = d?.expression?.trim()
    ? d.expression.trim()
    : summarizeCondition(d?.condition, isDefault, fieldLabel)
  const label = isDefault ? "默认" : summary

  // 描边优先级：校验错误(destructive) > 选中(primary) > 常态
  const stroke = isError ? "var(--destructive)" : selected ? "var(--primary)" : undefined
  const strokeWidth = isError ? 2.5 : selected ? 2.5 : 1.5

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke, strokeWidth }} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn(
              "pointer-events-none absolute max-w-40 truncate rounded border bg-background px-1.5 py-0.5 text-[11px] shadow-sm",
              isError
                ? "border-destructive text-destructive"
                : isDefault
                  ? "border-slate-400/50 text-muted-foreground"
                  : "border-amber-500/40 text-amber-600 dark:text-amber-400",
              selected && !isError && "ring-1 ring-primary",
            )}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
