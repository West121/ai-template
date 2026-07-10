/**
 * 下一代流程设计器 · 模型级 BPMN 连接规则校验器（切片 2）。
 *
 * 两个入口：
 *  - `validateProcessModel(pm)`：保存前全量校验，返回错误/警告列表（error 应拦截保存，warning 仅提示）。
 *  - `validateConnection(source, target, edges)`：连线时的即时校验，非法连接直接拒绝（返回 reason 供提示）。
 *
 * 覆盖规则（依据 docs/design/next-gen-workflow-and-formula.md 1.3 + 附录 C.3/C.4）：
 *  - 起始事件无入边、结束事件无出边；缺开始/结束事件。
 *  - 网关须有分叉/合流（既非分叉也非合流→警告）；网关不得悬空。
 *  - 禁止悬空节点（按类型要求入/出边）。
 *  - 排它/包容网关出边须配条件或默认；无默认分支→警告；多默认→错误。
 *  - 并行网关出边不得带条件/默认。
 *  - 附录 C.3：autoReject 可达路径必须能到达 terminate 结束事件，缺失拦截。
 *  - 附录 C.4：同一条边 condition 与 expression 不可同时设置。
 *  - 节点专属 config 完整性（delegate/ai/webhook/callActivity/timer/timerBoundary.attachedTo）。
 *  - 嵌入式子流程 children 递归校验。
 *
 * 纯数据、无 React 依赖（仅 import type），便于独立单测。禁 any；import type。
 */
import type { FlowNode, FlowNodeType, ProcessModel, SequenceFlow } from "./model"
import { isActivityNode, isGatewayNode } from "./model"

export type IssueLevel = "error" | "warning"

export interface ValidationIssue {
  level: IssueLevel
  /** 稳定规则码，便于测试/定位 */
  code: string
  message: string
  /** 关联节点 id（可空） */
  nodeId?: string
  /** 关联边 id（可空） */
  edgeId?: string
}

/* ============================================================
 * 即时连线校验
 * ============================================================ */

export interface ConnectionEndpoint {
  id: string
  type: FlowNodeType
}

export interface ConnectionResult {
  ok: boolean
  reason?: string
}

/** 连线时即时校验：非法连接直接拒绝。edges 为现有边（仅需 source/target）。 */
export function validateConnection(
  source: ConnectionEndpoint,
  target: ConnectionEndpoint,
  edges: readonly { source: string; target: string }[],
): ConnectionResult {
  if (source.id === target.id) return { ok: false, reason: "不能连接到自身" }
  if (source.type === "endEvent") return { ok: false, reason: "结束事件不能有出边" }
  if (target.type === "startEvent") return { ok: false, reason: "开始事件不能有入边" }
  if (target.type === "timerBoundary") {
    return { ok: false, reason: "边界定时事件通过附着关系绑定宿主，不接受入边" }
  }
  if (edges.some((e) => e.source === source.id && e.target === target.id)) {
    return { ok: false, reason: "该连线已存在" }
  }
  return { ok: true }
}

/* ============================================================
 * 模型级校验
 * ============================================================ */

/** 全量校验：顶层图 + 递归子流程 */
export function validateProcessModel(pm: ProcessModel): ValidationIssue[] {
  return validateGraph(pm.nodes, pm.edges, "")
}

/** 是否为「有默认出边」概念的排它/包容网关 */
function isDefaultableGateway(type: FlowNodeType): boolean {
  return type === "exclusiveGateway" || type === "inclusiveGateway"
}

/** 边是否带任意条件（结构化 / 高级表达式） */
function edgeHasCondition(e: SequenceFlow): boolean {
  const hasCond = Boolean(e.condition && e.condition.items.length > 0)
  const hasExpr = Boolean(e.expression && e.expression.trim())
  return hasCond || hasExpr
}

/**
 * 单张图校验（顶层或子流程共用）。prefix 用于子流程节点 id 的可读前缀。
 */
function validateGraph(nodes: FlowNode[], edges: SequenceFlow[], prefix: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const pfx = (id: string) => (prefix ? `${prefix} › ${id}` : id)

  const nodeById = new Map<string, FlowNode>()
  for (const n of nodes) nodeById.set(n.id, n)

  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  const outEdges = new Map<string, SequenceFlow[]>()
  for (const n of nodes) {
    inDeg.set(n.id, 0)
    outDeg.set(n.id, 0)
    outEdges.set(n.id, [])
  }

  /* ---- 边合法性 + 度数统计 + C.4 ---- */
  for (const e of edges) {
    if (!nodeById.has(e.source)) {
      issues.push({ level: "error", code: "EDGE_DANGLING_SOURCE", edgeId: e.id, message: `连线 ${e.id} 的源节点不存在` })
      continue
    }
    if (!nodeById.has(e.target)) {
      issues.push({ level: "error", code: "EDGE_DANGLING_TARGET", edgeId: e.id, message: `连线 ${e.id} 的目标节点不存在` })
      continue
    }
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1)
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
    outEdges.get(e.source)?.push(e)

    // 附录 C.4：condition 与 expression 互斥
    const hasCond = Boolean(e.condition && e.condition.items.length > 0)
    const hasExpr = Boolean(e.expression && e.expression.trim())
    if (hasCond && hasExpr) {
      issues.push({
        level: "error",
        code: "EDGE_CONDITION_EXPRESSION_CONFLICT",
        edgeId: e.id,
        message: `连线 ${e.id} 不能同时设置结构化条件与高级表达式（附录 C.4）`,
      })
    }
  }

  /* ---- 事件存在性 ---- */
  const startCount = nodes.filter((n) => n.type === "startEvent").length
  const endCount = nodes.filter((n) => n.type === "endEvent").length
  if (startCount === 0) issues.push({ level: "error", code: "NO_START", message: prefix ? `子流程「${prefix}」缺少开始事件` : "缺少开始事件" })
  if (endCount === 0) issues.push({ level: "error", code: "NO_END", message: prefix ? `子流程「${prefix}」缺少结束事件` : "缺少结束事件" })

  /* ---- 逐节点：入/出边约束 + 悬空 + 网关分叉合流 ---- */
  for (const n of nodes) {
    const i = inDeg.get(n.id) ?? 0
    const o = outDeg.get(n.id) ?? 0

    switch (n.type) {
      case "startEvent":
        if (i > 0) issues.push({ level: "error", code: "START_HAS_INCOMING", nodeId: n.id, message: `开始事件「${pfx(n.name)}」不能有入边` })
        if (o === 0) issues.push({ level: "error", code: "START_NO_OUTGOING", nodeId: n.id, message: `开始事件「${pfx(n.name)}」缺少出边` })
        break
      case "endEvent":
        if (o > 0) issues.push({ level: "error", code: "END_HAS_OUTGOING", nodeId: n.id, message: `结束事件「${pfx(n.name)}」不能有出边` })
        if (i === 0) issues.push({ level: "error", code: "END_NO_INCOMING", nodeId: n.id, message: `结束事件「${pfx(n.name)}」缺少入边（悬空）` })
        break
      case "timerBoundary":
        // 边界事件靠 attachedTo 绑定宿主，不走入边；仅需出边
        if (i > 0) issues.push({ level: "error", code: "BOUNDARY_HAS_INCOMING", nodeId: n.id, message: `边界定时事件「${pfx(n.name)}」不接受入边（应通过附着关系绑定宿主）` })
        if (o === 0) issues.push({ level: "warning", code: "BOUNDARY_NO_OUTGOING", nodeId: n.id, message: `边界定时事件「${pfx(n.name)}」缺少出边（到点后无后继）` })
        break
      default:
        if (i === 0) issues.push({ level: "error", code: "NODE_NO_INCOMING", nodeId: n.id, message: `节点「${pfx(n.name)}」无入边（悬空）` })
        if (o === 0) issues.push({ level: "error", code: "NODE_NO_OUTGOING", nodeId: n.id, message: `节点「${pfx(n.name)}」无出边（悬空）` })
    }

    // 网关分叉/合流
    if (isGatewayNode(n)) {
      const isFork = o >= 2
      const isJoin = i >= 2
      if (!isFork && !isJoin && i >= 1 && o >= 1) {
        issues.push({ level: "warning", code: "GATEWAY_NO_SPLIT_JOIN", nodeId: n.id, message: `网关「${pfx(n.name)}」既非分叉也非合流（建议改为直连或删除）` })
      }
    }
  }

  /* ---- 网关出边条件规则 ---- */
  for (const n of nodes) {
    if (!isGatewayNode(n)) continue
    const outs = outEdges.get(n.id) ?? []

    if (n.type === "parallelGateway") {
      for (const e of outs) {
        if (edgeHasCondition(e) || e.isDefault) {
          issues.push({ level: "error", code: "PARALLEL_OUT_HAS_CONDITION", nodeId: n.id, edgeId: e.id, message: `并行网关「${pfx(n.name)}」的出边不应带条件或默认标记` })
        }
      }
    }

    if (isDefaultableGateway(n.type)) {
      const defaults = outs.filter((e) => e.isDefault)
      if (defaults.length > 1) {
        issues.push({ level: "error", code: "GATEWAY_MULTIPLE_DEFAULT", nodeId: n.id, message: `网关「${pfx(n.name)}」配置了多条默认分支（至多一条）` })
      }
      if (defaults.length === 0 && outs.length > 0) {
        issues.push({ level: "warning", code: "GATEWAY_NO_DEFAULT", nodeId: n.id, message: `网关「${pfx(n.name)}」未配置默认分支（条件全不命中时将无出口）` })
      }
      for (const e of outs) {
        if (!e.isDefault && !edgeHasCondition(e)) {
          issues.push({ level: "error", code: "GATEWAY_OUT_NO_CONDITION", nodeId: n.id, edgeId: e.id, message: `网关「${pfx(n.name)}」的出边缺少条件（或标记为默认分支）` })
        }
      }
    }
  }

  /* ---- 附录 C.3：autoReject 可达路径须有 terminate end ---- */
  const adjacency = new Map<string, string[]>()
  for (const n of nodes) adjacency.set(n.id, [])
  for (const e of edges) {
    if (nodeById.has(e.source) && nodeById.has(e.target)) adjacency.get(e.source)?.push(e.target)
  }
  const terminateEnds = new Set(nodes.filter((n) => n.type === "endEvent" && n.terminate).map((n) => n.id))
  for (const n of nodes) {
    if (n.type !== "serviceTask" || n.service.impl !== "autoReject") continue
    if (!reachesAny(n.id, adjacency, terminateEnds)) {
      issues.push({
        level: "error",
        code: "AUTOREJECT_NO_TERMINATE",
        nodeId: n.id,
        message: `自动拒绝节点「${pfx(n.name)}」的可达路径缺少 terminate 结束事件（附录 C.3）`,
      })
    }
  }

  /* ---- 节点专属 config 完整性 ---- */
  for (const n of nodes) {
    switch (n.type) {
      case "serviceTask":
        if (n.service.impl === "delegate" && !n.service.delegateExpression.trim()) {
          issues.push({ level: "warning", code: "SERVICE_DELEGATE_EMPTY", nodeId: n.id, message: `服务任务「${pfx(n.name)}」未配置 delegateExpression` })
        }
        if (n.service.impl === "trigger" && !n.service.handler?.trim() && !n.service.webhookUrl?.trim()) {
          issues.push({ level: "warning", code: "TRIGGER_EMPTY", nodeId: n.id, message: `触发器「${pfx(n.name)}」未配置 handler 或 webhookUrl` })
        }
        break
      case "ai":
        if (!n.ai.model.trim()) issues.push({ level: "warning", code: "AI_NO_MODEL", nodeId: n.id, message: `AI 审批「${pfx(n.name)}」未配置模型（后端降级规则模拟）` })
        break
      case "webhook":
        if (!n.webhook.url.trim()) issues.push({ level: "warning", code: "WEBHOOK_NO_URL", nodeId: n.id, message: `Webhook「${pfx(n.name)}」未配置回调地址` })
        break
      case "callActivity":
        if (!n.callActivity.calledElement.trim()) issues.push({ level: "warning", code: "CALL_NO_TARGET", nodeId: n.id, message: `子流程调用「${pfx(n.name)}」未选择子流程定义` })
        break
      case "timerCatch":
        if (!n.timer.value.trim()) issues.push({ level: "warning", code: "TIMER_NO_VALUE", nodeId: n.id, message: `定时「${pfx(n.name)}」未配置时间` })
        break
      case "timerBoundary": {
        if (!n.timer.value.trim()) issues.push({ level: "warning", code: "TIMER_NO_VALUE", nodeId: n.id, message: `边界定时「${pfx(n.name)}」未配置时间` })
        const host = n.attachedTo ? nodeById.get(n.attachedTo) : undefined
        if (!host) {
          issues.push({ level: "error", code: "BOUNDARY_NO_HOST", nodeId: n.id, message: `边界定时「${pfx(n.name)}」未附着到有效活动节点` })
        } else if (!isActivityNode(host)) {
          issues.push({ level: "error", code: "BOUNDARY_BAD_HOST", nodeId: n.id, message: `边界定时「${pfx(n.name)}」的宿主「${host.name}」不是可附着的活动节点` })
        }
        break
      }
      case "subProcess":
        // 递归校验内联子图
        issues.push(...validateGraph(n.children.nodes, n.children.edges, n.name))
        break
      default:
        break
    }
  }

  return issues
}

/** 从 start 出发 BFS，能否到达 targets 中任意节点 */
function reachesAny(start: string, adjacency: Map<string, string[]>, targets: Set<string>): boolean {
  if (targets.has(start)) return true
  const seen = new Set<string>([start])
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.shift()
    if (cur === undefined) break
    for (const next of adjacency.get(cur) ?? []) {
      if (targets.has(next)) return true
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return false
}
