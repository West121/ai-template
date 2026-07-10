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

/** 节点包围盒（中心 + 半宽半高）；measured 缺失（首帧）时回退 node.width/height 或类型默认，绝不返回 0 */
function nodeBox(n: InternalNode): { cx: number; cy: number; hw: number; hh: number } {
  const nn = n as InternalNode & { width?: number; height?: number }
  const w = n.measured.width || nn.width || 100
  const h = n.measured.height || nn.height || 60
  const x = n.internals.positionAbsolute.x
  const y = n.internals.positionAbsolute.y
  return { cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2 }
}

/**
 * 从节点中心朝目标中心的射线与该节点**包围盒边界**的交点 + 所在边朝向。
 * 保证连线端点恰好落在节点边界上（不进入节点体），并给出对应的 Position 供正交路由定向。
 */
function boundaryPoint(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  towardX: number,
  towardY: number,
): { x: number; y: number; pos: Position } {
  const dx = towardX - cx
  const dy = towardY - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy, pos: Position.Top }
  // 沿射线缩放到最先触及的一条边：scaleX 触左右边、scaleY 触上下边，取较小者
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY
  const scale = Math.min(scaleX, scaleY)
  const x = cx + dx * scale
  const y = cy + dy * scale
  const pos =
    scaleX < scaleY ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top
  return { x, y, pos }
}

/**
 * 依 source/target 节点几何求各自「中心连线 × 包围盒」的边界交点作入/出锚，供 getSmoothStepPath 出正交线。
 * 端点始终落在节点边界（含箭头），绝不插入节点体——即便种子边无 sourceHandle/targetHandle、
 * 或自动布局后坐标偏移/重叠也稳健。竖直对齐时退化为上/下边中点 → 竖直直线（与旧观感一致）。
 */
function floatingAnchors(s: InternalNode, t: InternalNode): FloatingAnchors {
  const S = nodeBox(s)
  const T = nodeBox(t)
  const a = boundaryPoint(S.cx, S.cy, S.hw, S.hh, T.cx, T.cy)
  const b = boundaryPoint(T.cx, T.cy, T.hw, T.hh, S.cx, S.cy)
  return {
    sourceX: a.x,
    sourceY: a.y,
    sourcePosition: a.pos,
    targetX: b.x,
    targetY: b.y,
    targetPosition: b.pos,
  }
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
