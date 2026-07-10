/**
 * 顺序流边（BPMN sequenceFlow）：**正交直角浮动路由** + 中点标签。
 *
 * 路由（W-“线不直”修复）：不依赖边固定挂靠的某个 Handle，而是按 source/target 节点的
 * **实时几何**（`useInternalNode` 取绝对坐标 + 量得尺寸）挑最近的一条边（上/下/左/右）出入线，
 * 再交给 react-flow 自带的 `getSmoothStepPath`（正交直角 + `borderRadius` 小圆角）成线：
 *  - 上下对齐 → 竖直笔直线（source 底中点 ↔ target 顶中点，横坐标相同，无折角）；
 *  - 错位 → 规整的「直段 + 直角折 + 直段」，无 S 形/斜线/多余弯（对齐 bpmn-js 观感）。
 * 该几何完全决定描画路径，故边是否带 sourceHandle/targetHandle **不影响成线**——序列化层
 * 不存 Handle，往返丢失 Handle 也不改变渲染（见 serialize.ts）。
 *
 * 打磨保留：有结构化 condition / 高级 expression 时展示条件摘要（字段显示表单 label，W-07）；
 * isDefault 时展示「默认」标记；选中描边走 `--primary` 加粗（W-10）；校验错误走 `--destructive`（W-14）；
 * 运行时跟踪高亮（active 主题色 / completed 绿）保留。
 */
import { useContext, useMemo } from "react"
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react"
import { cn } from "@/lib/utils"
import type { WfEdgeData } from "../serialize"
import { summarizeCondition } from "../summary"
import { FormFieldsContext } from "../nodes/node-chrome"

/** 正交浮动路由的入/出锚（某条边的中点 + 朝向） */
interface FloatingAnchors {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
}

/**
 * 依 source/target 节点几何挑最近边、取各自「边中点」作入/出锚，供 getSmoothStepPath 出正交线。
 * 竖直位差占优走上/下、水平位差占优走左/右；尺寸未测量出（首帧）时回退调用方给的锚点。
 */
function floatingAnchors(
  s: InternalNode,
  t: InternalNode,
): FloatingAnchors | null {
  const sw = s.measured.width
  const sh = s.measured.height
  const tw = t.measured.width
  const th = t.measured.height
  if (!sw || !sh || !tw || !th) return null

  const sx = s.internals.positionAbsolute.x
  const sy = s.internals.positionAbsolute.y
  const tx = t.internals.positionAbsolute.x
  const ty = t.internals.positionAbsolute.y
  const scx = sx + sw / 2
  const scy = sy + sh / 2
  const tcx = tx + tw / 2
  const tcy = ty + th / 2
  const dx = tcx - scx
  const dy = tcy - scy

  // 竖直位差 >= 水平位差 → 走上/下边（对齐时同横坐标即成竖直直线）；否则走左/右边。
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? { sourceX: scx, sourceY: sy + sh, sourcePosition: Position.Bottom, targetX: tcx, targetY: ty, targetPosition: Position.Top }
      : { sourceX: scx, sourceY: sy, sourcePosition: Position.Top, targetX: tcx, targetY: ty + th, targetPosition: Position.Bottom }
  }
  return dx >= 0
    ? { sourceX: sx + sw, sourceY: scy, sourcePosition: Position.Right, targetX: tx, targetY: tcy, targetPosition: Position.Left }
    : { sourceX: sx, sourceY: scy, sourcePosition: Position.Left, targetX: tx + tw, targetY: tcy, targetPosition: Position.Right }
}

export function SequenceFlowEdge({
  id,
  source,
  target,
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
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const anchors = sourceNode && targetNode ? floatingAnchors(sourceNode, targetNode) : null

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: anchors?.sourceX ?? sourceX,
    sourceY: anchors?.sourceY ?? sourceY,
    sourcePosition: anchors?.sourcePosition ?? sourcePosition ?? Position.Bottom,
    targetX: anchors?.targetX ?? targetX,
    targetY: anchors?.targetY ?? targetY,
    targetPosition: anchors?.targetPosition ?? targetPosition ?? Position.Top,
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
  const highlight = d?.highlight
  const summary = d?.expression?.trim()
    ? d.expression.trim()
    : summarizeCondition(d?.condition, isDefault, fieldLabel)
  const label = isDefault ? "默认" : summary

  // 描边优先级：校验错误(destructive) > 运行时跟踪高亮(completed 绿 / active 主题色) > 选中(primary) > 常态
  const stroke = isError
    ? "var(--destructive)"
    : highlight === "active"
      ? "var(--primary)"
      : highlight === "completed"
        ? "#10b981"
        : selected
          ? "var(--primary)"
          : undefined
  const strokeWidth = isError || highlight || selected ? 2.5 : 1.5

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
