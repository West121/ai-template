/**
 * BPMN 发布前校验：规则清单 + 画布错误高亮（canvas addMarker 'oa-error'）。
 * 供发布/保存前调用，有 error 时应阻止发布并展示清单。
 */
import { readNodeConfig } from "./serde"

export type IssueLevel = "error" | "warn"

export interface ValidationIssue {
  /** 关联元素 id（用于画布高亮 / 清单跳转），流程级问题可省略 */
  elementId?: string
  level: IssueLevel
  message: string
}

/* ---------- 精简服务类型 ---------- */

interface FlowElement {
  id: string
  type: string
  businessObject: {
    $type: string
    name?: string
    eventDefinitions?: Array<{ $type: string }>
    conditionExpression?: unknown
    default?: unknown
  }
  incoming?: FlowElement[]
  outgoing?: FlowElement[]
  source?: FlowElement
  target?: FlowElement
}

interface ElementRegistry {
  getAll(): FlowElement[]
  get(id: string): FlowElement | undefined
}
interface Canvas {
  addMarker(id: string, marker: string): void
  removeMarker(id: string, marker: string): void
}
interface ModelerLike {
  get(name: "elementRegistry"): ElementRegistry
  get(name: "canvas"): Canvas
}

export const ERROR_MARKER = "oa-error"

const isType = (el: FlowElement, t: string) => el.businessObject.$type === t
const isGateway = (el: FlowElement) => /Gateway$/.test(el.businessObject.$type)
const labelOf = (el: FlowElement) => el.businessObject.name || el.id

/** 清除上一轮校验高亮 */
export function clearValidationMarkers(modeler: ModelerLike): void {
  const registry = modeler.get("elementRegistry")
  const canvas = modeler.get("canvas")
  for (const el of registry.getAll()) canvas.removeMarker(el.id, ERROR_MARKER)
}

/**
 * 执行校验并高亮错误元素。
 * @returns 问题清单（error 存在即应阻止发布）
 */
export function validateBpmn(modeler: ModelerLike): ValidationIssue[] {
  const registry = modeler.get("elementRegistry")
  const canvas = modeler.get("canvas")
  const all = registry.getAll()
  const issues: ValidationIssue[] = []

  clearValidationMarkers(modeler)

  const isFlowNode = (el: FlowElement) =>
    el.type !== "bpmn:SequenceFlow" &&
    el.type !== "label" &&
    !el.type.endsWith(":Process") &&
    !el.type.endsWith("Definitions") &&
    !!el.businessObject?.$type &&
    (el.businessObject.$type.startsWith("bpmn:") &&
      el.businessObject.$type !== "bpmn:Process")

  const nodes = all.filter(isFlowNode)
  const starts = nodes.filter((n) => isType(n, "bpmn:StartEvent"))
  const ends = nodes.filter((n) => isType(n, "bpmn:EndEvent"))

  // 1. 唯一开始节点
  if (starts.length === 0) {
    issues.push({ level: "error", message: "缺少开始节点" })
  } else if (starts.length > 1) {
    for (const s of starts)
      issues.push({ elementId: s.id, level: "error", message: "存在多个开始节点，只能有一个" })
  }

  // 2. 必须有结束节点
  if (ends.length === 0) {
    issues.push({ level: "error", message: "缺少结束节点" })
  }

  // 3. 可达性（从开始 BFS）
  const reached = new Set<string>()
  const queue = [...starts]
  for (const s of starts) reached.add(s.id)
  while (queue.length) {
    const cur = queue.shift()!
    for (const flow of cur.outgoing ?? []) {
      const next = flow.target
      if (next && !reached.has(next.id)) {
        reached.add(next.id)
        queue.push(next)
      }
    }
  }
  let endReached = false
  for (const e of ends) if (reached.has(e.id)) endReached = true
  if (ends.length > 0 && !endReached) {
    issues.push({ level: "error", message: "结束节点不可达" })
  }

  // 4. 逐节点检查
  for (const node of nodes) {
    const inCount = (node.incoming ?? []).length
    const outCount = (node.outgoing ?? []).length

    // 4a. 悬空 / 不可达
    if (starts.length > 0 && !reached.has(node.id)) {
      issues.push({ elementId: node.id, level: "error", message: `「${labelOf(node)}」不可达（无法从开始节点到达）` })
    }
    if (!isType(node, "bpmn:StartEvent") && inCount === 0) {
      issues.push({ elementId: node.id, level: "error", message: `「${labelOf(node)}」缺少入口连线` })
    }
    if (!isType(node, "bpmn:EndEvent") && outCount === 0) {
      issues.push({ elementId: node.id, level: "error", message: `「${labelOf(node)}」缺少出口连线` })
    }

    // 4b. 非网关节点必须单出口（图13：审批节点两个出口需改用网关）
    if (!isGateway(node) && !isType(node, "bpmn:EndEvent") && outCount > 1) {
      issues.push({
        elementId: node.id,
        level: "error",
        message: `「${labelOf(node)}」有多个出口，请改用网关分流（非网关节点只能有一个出口）`,
      })
    }

    // 4c. 审批节点(UserTask) 必配处理人
    if (isType(node, "bpmn:UserTask")) {
      const cfg = readNodeConfig(node.businessObject)
      if ((cfg.assigneeRules ?? []).length === 0) {
        issues.push({ elementId: node.id, level: "error", message: `审批节点「${labelOf(node)}」未配置处理人` })
      }
    }

    // 4d. 排它网关分支：至少两个出口 + 需有条件或默认分支
    if (isType(node, "bpmn:ExclusiveGateway") && outCount > 1) {
      const branches = node.outgoing ?? []
      const hasDefault = branches.some((b) => node.businessObject.default === b.businessObject)
      const missingCond = branches.filter(
        (b) => !b.businessObject.conditionExpression && node.businessObject.default !== b.businessObject,
      )
      if (!hasDefault && missingCond.length > 0) {
        issues.push({
          elementId: node.id,
          level: "warn",
          message: `排它网关「${labelOf(node)}」存在未设条件的分支，且无默认分支，可能导致流转不确定`,
        })
      }
    }
    if (isGateway(node) && outCount <= 1 && inCount <= 1) {
      issues.push({ elementId: node.id, level: "warn", message: `网关「${labelOf(node)}」既未分流也未汇聚，可考虑移除` })
    }
  }

  // 高亮 error 元素
  for (const issue of issues) {
    if (issue.elementId && issue.level === "error") canvas.addMarker(issue.elementId, ERROR_MARKER)
  }

  return issues
}
