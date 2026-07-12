/**
 * 流程图预览增强（2026-07-12 定稿）——**纯数据映射层**（无 React，可 node 直测）。
 *
 * 把实例 `timeline`（wf_operation ∪ 评论，已带 nodeId）+ `highlight` + `currentNodes` 归一为
 * 每个节点的运行时办理信息 `NodeRuntimeInfo`（状态角标 + 办理人链 + 意见摘要），供 FlowViewer
 * 叠加层渲染（① 节点办理信息）；并按时间序抽出 `replaySteps`（② 回放）与预测边推导（③ 预测）。
 *
 * 与 highlight 机制同源：瞬态、只读，不写回 ProcessModel、不序列化。
 */
import type { WfHighlight, WfTimelineItem } from "@/types/workflow"

/** 节点运行时状态：未到达灰 / 进行中蓝 / 已通过绿 / 驳回红 / 加签紫 */
export type NodeRuntimeStatus = "notReached" | "active" | "completed" | "rejected" | "addSign"

/** 一位办理人的记录（弹卡逐行展示） */
export interface NodeRuntimeHandler {
  name: string
  time?: string
  /** 意见摘要（已去 HTML 标签、截断） */
  opinion?: string
  /** 原始动作码（APPROVE/REJECT/…，用于图标） */
  action?: string
}

/** 单节点运行时信息（叠加层消费） */
export interface NodeRuntimeInfo {
  status: NodeRuntimeStatus
  /** 已办/在办办理人（多人节点列全部） */
  assignees: NodeRuntimeHandler[]
  /** 最近办理时间（缩略行展示） */
  time?: string
  /** 最近意见摘要 */
  opinion?: string
}

// 以下三组对齐后端 WfOperation 的真实 action 枚举（server .../entity/WfOperation.java），
// 不要臆造：后端无 AI_REJECT/ROLLBACK/ADDSIGN/COUNTERSIGN 等，加签是 COUNTER_SIGN（带下划线）。
/** 驳回/终止类动作 → rejected（REJECT 驳回 / VOTE_REJECT 投票驳回 / TERMINATE 终止） */
const REJECT_ACTIONS = new Set(["REJECT", "VOTE_REJECT", "TERMINATE"])
/** 加签/多签类动作 → addSign（ADD_SIGN 加签 / COUNTER_SIGN 并签会签 / REDUCE_SIGN 减签） */
const ADD_SIGN_ACTIONS = new Set(["ADD_SIGN", "COUNTER_SIGN", "REDUCE_SIGN"])
/** 不计入"节点办理人"的通知/留言/传阅类动作（仍在时间线展示，但不定节点状态/办理人） */
const NON_HANDLER_ACTIONS = new Set(["CC", "URGE", "READ", "COMMENT"])

/** 去 HTML 标签 + 折叠空白 + 截断（意见可能是富文本） */
export function stripHtml(html: string | undefined, max = 48): string | undefined {
  if (!html) return undefined
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * 由 timeline + highlight + currentNodes 构建 nodeId → NodeRuntimeInfo。
 * 状态判定优先级：active（highlight/current） > rejected > addSign > completed。
 * 仅收录"有信息"的节点（已办/在办/已完成）；未到达节点不入表，由 FlowViewer 按模型补灰。
 */
export function buildNodeInfo(
  timeline: WfTimelineItem[] | undefined,
  highlight: WfHighlight | undefined,
  currentNodes: Array<{ nodeId?: string; nodeName?: string }> | undefined,
): Record<string, NodeRuntimeInfo> {
  const active = new Set((highlight?.active ?? []).filter(Boolean))
  const completed = new Set((highlight?.completed ?? []).filter(Boolean))
  for (const c of currentNodes ?? []) if (c.nodeId) active.add(c.nodeId)

  // 按 nodeId 分组（保序）
  const byNode = new Map<string, WfTimelineItem[]>()
  for (const it of timeline ?? []) {
    if (!it.nodeId) continue
    const arr = byNode.get(it.nodeId)
    if (arr) arr.push(it)
    else byNode.set(it.nodeId, [it])
  }

  const out: Record<string, NodeRuntimeInfo> = {}

  for (const [nodeId, items] of byNode) {
    const handlerItems = items.filter((i) => i.actorName && !NON_HANDLER_ACTIONS.has(i.action))
    const assignees: NodeRuntimeHandler[] = handlerItems.map((i) => ({
      name: i.actorName as string,
      time: i.createdAt,
      opinion: stripHtml(i.comment),
      action: i.action,
    }))
    let status: NodeRuntimeStatus
    if (active.has(nodeId)) status = "active"
    else if (items.some((i) => REJECT_ACTIONS.has(i.action))) status = "rejected"
    else if (items.some((i) => ADD_SIGN_ACTIONS.has(i.action))) status = "addSign"
    else status = "completed"
    const last = handlerItems[handlerItems.length - 1] ?? items[items.length - 1]
    out[nodeId] = { status, assignees, time: last?.createdAt, opinion: stripHtml(last?.comment) }
  }

  // active / completed 但无 timeline 记录的节点（网关、系统节点等）补状态
  for (const nid of active) if (!out[nid]) out[nid] = { status: "active", assignees: [] }
  for (const nid of completed) if (!out[nid]) out[nid] = { status: "completed", assignees: [] }

  return out
}

/** 时间序回放步骤：timeline 的 nodeId 去重（相邻去重，保历史经过顺序） */
export function buildReplaySteps(timeline: WfTimelineItem[] | undefined): string[] {
  const seq: string[] = []
  for (const it of timeline ?? []) {
    if (it.nodeId && seq[seq.length - 1] !== it.nodeId) seq.push(it.nodeId)
  }
  return seq
}

/**
 * 预测边推导：给定预测节点序列 predictedIds 与当前活动节点 activeIds，
 * 标记 model 中"进入预测节点"的边（source ∈ active∪predicted，target ∈ predicted）为预测边。
 * 返回预测边 id 集合（虚线蓝）。
 */
export function predictedEdgeIds(
  edges: Array<{ id: string; source: string; target: string }>,
  predictedIds: string[],
  activeIds: string[],
): Set<string> {
  const pred = new Set(predictedIds)
  const from = new Set([...predictedIds, ...activeIds])
  const out = new Set<string>()
  for (const e of edges) {
    if (pred.has(e.target) && from.has(e.source)) out.add(e.id)
  }
  return out
}

/**
 * 反向可达祖先集合（含种子本身）：从 seed 节点沿边**反向 BFS** 回溯所有祖先。
 * 用于钉钉盒式图「走过路径」判定——结构节点(dot/branch/merge) id 不在 highlight，无法直接命中，
 * 以"已到达节点(completed/active)"为种子反查：条件分支只回溯命中支（有已到达子节点的那支），
 * 未命中支不入集；并行汇聚多个父支都回溯到（都走过）。
 */
export function reachableAncestors(edges: Array<{ source: string; target: string }>, seedIds: string[]): Set<string> {
  const rev = new Map<string, string[]>()
  for (const e of edges) {
    const a = rev.get(e.target)
    if (a) a.push(e.source)
    else rev.set(e.target, [e.source])
  }
  const out = new Set<string>()
  const st = [...seedIds]
  while (st.length) {
    const n = st.pop() as string
    if (out.has(n)) continue
    out.add(n)
    for (const s of rev.get(n) ?? []) if (!out.has(s)) st.push(s)
  }
  return out
}

/**
 * 回放某一步的边推导：走到 steps[i] 时，模型里 steps[i-1]→steps[i] 的边即"正在走过"的流光边。
 * 返回该边 id（无则 null）。
 */
export function replayFlowEdgeId(
  edges: Array<{ id: string; source: string; target: string }>,
  steps: string[],
  stepIndex: number,
): string | null {
  if (stepIndex <= 0 || stepIndex >= steps.length) return null
  const from = steps[stepIndex - 1]
  const to = steps[stepIndex]
  const hit = edges.find((e) => e.source === from && e.target === to)
  return hit?.id ?? null
}
