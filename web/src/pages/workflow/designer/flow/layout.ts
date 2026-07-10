/**
 * 下一代流程设计器 · 自动布局（dagre 有向图布局）。
 *
 * 用途（设计文档 1.3「elkjs/dagre 自动布局」）：
 *  a) 工具栏「整理布局」——对当前 nodes/edges 跑一次有向图布局，回写各节点 position；
 *  b) `.bpmn` 导入 / 旧 designerJson 迁移后，节点缺真实坐标（挤在兜底位、相互重叠）时一键整理。
 *
 * 选型：**dagre**（`@dagrejs/dagre`，维护活跃的官方 fork，自带 TS 类型，无需 @types）。
 * 相比 elkjs（Web Worker / 异步 / 体积更大），dagre 同步、轻量，足够覆盖审批流这类
 * 中小规模有向无环/含环图，且同步 API 便于在按钮回调里即时回写 + 单测。
 *
 * **只改 position**：布局仅覆盖每个节点的 `position.x/y`，节点 `data`（含 size/props/config）
 * 与边一律原样保留。故布局后 `toProcessModel → fromProcessModel` 往返仍字节一致（见 layout.test.ts）。
 *
 * 坐标口径对齐：dagre 产出的是**节点中心**坐标，react-flow `position` 是**左上角**；
 * 转换时减去半宽高，并对齐 20×20 点阵（与 canvas.tsx 的 snapGrid 一致），保证整数、无抖动。
 *
 * 禁 any；类型导入一律 import type（verbatimModuleSyntax）。
 */
import Dagre from "@dagrejs/dagre"
import type { FlowNodeType } from "./model"
import type { WfRfEdge, WfRfNode } from "./serialize"

/** 布局方向与间距（默认自上而下，贴合审批流阅读习惯） */
export interface LayoutOptions {
  /** 主方向：TB=自上而下（默认）/ LR=自左而右 */
  direction?: "TB" | "LR"
  /** 同一层内节点间距（px） */
  nodeSep?: number
  /** 层与层之间的间距（px） */
  rankSep?: number
}

const DEFAULT_OPTIONS: Required<LayoutOptions> = { direction: "TB", nodeSep: 60, rankSep: 80 }

/**
 * 各类型节点的兜底渲染尺寸（与 node-catalog.ts 的 EVENT/GATEWAY/ACTIVITY/SUBPROCESS 常量口径一致）。
 * 优先取 node.data.size；缺省时按类型给默认，供 dagre 计算包围盒。
 */
const DEFAULT_SIZE_BY_TYPE: Record<FlowNodeType, { w: number; h: number }> = {
  startEvent: { w: 48, h: 48 },
  endEvent: { w: 48, h: 48 },
  timerCatch: { w: 48, h: 48 },
  timerBoundary: { w: 48, h: 48 },
  exclusiveGateway: { w: 48, h: 48 },
  parallelGateway: { w: 48, h: 48 },
  inclusiveGateway: { w: 48, h: 48 },
  userTask: { w: 208, h: 64 },
  serviceTask: { w: 208, h: 64 },
  callActivity: { w: 208, h: 64 },
  cc: { w: 208, h: 64 },
  ai: { w: 208, h: 64 },
  webhook: { w: 208, h: 64 },
  subProcess: { w: 208, h: 96 },
}

const FALLBACK_SIZE = { w: 160, h: 60 }

/** 取节点用于布局的宽高：优先 data.size，其次类型默认，最后兜底。 */
function sizeOf(node: WfRfNode): { w: number; h: number } {
  if (node.data.size) return { w: node.data.size.w, h: node.data.size.h }
  const t = node.type as FlowNodeType | undefined
  return (t && DEFAULT_SIZE_BY_TYPE[t]) || FALLBACK_SIZE
}

/** 对齐 20×20 点阵（与 canvas snapGrid 一致），保证整数坐标、往返无抖动。 */
function snap(v: number): number {
  return Math.round(v / 20) * 20
}

/**
 * 对 react-flow 的 nodes/edges 跑一次 dagre 有向图布局，返回**仅 position 被覆盖**的新节点数组
 * （原数组不变；边不参与返回，布局不动边）。`timerBoundary` 靠附着关系绑定宿主、无入边，
 * 布局后就近吸附到宿主下方，避免其作为孤立点漂散。
 */
export function layoutFlow(
  nodes: WfRfNode[],
  edges: WfRfEdge[],
  options: LayoutOptions = {},
): WfRfNode[] {
  const opt = { ...DEFAULT_OPTIONS, ...options }
  if (nodes.length === 0) return nodes

  const g = new Dagre.graphlib.Graph()
  g.setGraph({ rankdir: opt.direction, nodesep: opt.nodeSep, ranksep: opt.rankSep, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  const sizes = new Map<string, { w: number; h: number }>()
  for (const n of nodes) {
    const s = sizeOf(n)
    sizes.set(n.id, s)
    g.setNode(n.id, { width: s.w, height: s.h })
  }
  // 仅对两端都存在的边建图边（防御脏数据，避免 dagre 抛错）
  const nodeIds = new Set(nodes.map((n) => n.id))
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) g.setEdge(e.source, e.target)
  }

  Dagre.layout(g)

  // dagre 给的是中心坐标 → 转左上角；边界事件跟随宿主。
  const positioned = nodes.map((n): WfRfNode => {
    const gn = g.node(n.id)
    const s = sizes.get(n.id) ?? FALLBACK_SIZE
    if (!gn || typeof gn.x !== "number" || typeof gn.y !== "number") return n
    return { ...n, position: { x: snap(gn.x - s.w / 2), y: snap(gn.y - s.h / 2) } }
  })

  return attachBoundaryNodes(positioned)
}

/**
 * 边界定时事件（timerBoundary）无入边、不参与主图排布，dagre 会把它单列到一旁。
 * 布局后把它就近吸附到宿主活动节点的右下角（贴 BPMN 边界事件的常见画法），保持可读。
 */
function attachBoundaryNodes(nodes: WfRfNode[]): WfRfNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return nodes.map((n): WfRfNode => {
    if (n.type !== "timerBoundary") return n
    const hostId = typeof n.data.attachedTo === "string" ? n.data.attachedTo : ""
    const host = hostId ? byId.get(hostId) : undefined
    if (!host) return n
    const hs = host.data.size ?? DEFAULT_SIZE_BY_TYPE.userTask
    return { ...n, position: { x: snap(host.position.x + hs.w - 24), y: snap(host.position.y + hs.h - 24) } }
  })
}

/**
 * 是否需要自动整理：节点坐标退化（多点重叠 / 挤在同一兜底位）。
 * 用于导入 .bpmn / 迁移旧定义后判断是否提示一键整理。判据：存在两个及以上节点的
 * （snap 后）坐标完全重合 —— 兜底坐标最典型的表现就是全挤在原点或同一点。
 */
export function needsLayout(nodes: WfRfNode[]): boolean {
  if (nodes.length < 2) return false
  // 1) 坐标重合（多个节点挤在同一兜底点）
  const seen = new Set<string>()
  for (const n of nodes) {
    const key = `${snap(n.position.x)},${snap(n.position.y)}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  // 2) 包围盒明显重叠（节点卡相互压盖，如坐标偏紧/导入的旧数据）—— 需自动整理
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (boxesOverlap(nodes[i], nodes[j])) return true
    }
  }
  return false
}

/** 两节点包围盒是否明显重叠（各方向交叠 > 8px 才算，避免相邻/相切误判）。 */
function boxesOverlap(a: WfRfNode, b: WfRfNode): boolean {
  const sa = sizeOf(a)
  const sb = sizeOf(b)
  const ox = Math.min(a.position.x + sa.w, b.position.x + sb.w) - Math.max(a.position.x, b.position.x)
  const oy = Math.min(a.position.y + sa.h, b.position.y + sb.h) - Math.max(a.position.y, b.position.y)
  return ox > 8 && oy > 8
}
