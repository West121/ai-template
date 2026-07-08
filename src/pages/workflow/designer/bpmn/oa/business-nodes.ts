/**
 * 业务节点字典：设计器只对外暴露这些「业务语义」节点，屏蔽 BPMN 原生的
 * Send/Receive/Manual/Business rule task 等无关类型。palette / contextPad /
 * replaceMenu 三个 provider 共用本字典，保证左侧面板、追加、更改类型三处一致。
 */

export type BusinessGroup = "event" | "task" | "gateway"

export interface BusinessNode {
  /** 稳定 id，用于 action name */
  id: string
  /** 中文名 */
  label: string
  /** 映射的 BPMN 类型 */
  bpmnType: string
  /** 事件定义类型（定时节点用） */
  eventDefinitionType?: string
  /** 子流程展开态 */
  isExpanded?: boolean
  /** bpmn-js 内置图标 class（复用其字体图标） */
  className: string
  /** 分组：影响 palette 分组与「更改类型」候选集 */
  group: BusinessGroup
}

export const BUSINESS_NODES: BusinessNode[] = [
  {
    id: "start",
    label: "开始",
    bpmnType: "bpmn:StartEvent",
    className: "bpmn-icon-start-event-none",
    group: "event",
  },
  {
    id: "approval",
    label: "审批",
    bpmnType: "bpmn:UserTask",
    className: "bpmn-icon-user",
    group: "task",
  },
  {
    id: "cc",
    label: "抄送",
    bpmnType: "bpmn:Task",
    className: "bpmn-icon-task",
    group: "task",
  },
  {
    id: "ai",
    label: "AI 节点",
    bpmnType: "bpmn:ServiceTask",
    className: "bpmn-icon-service",
    group: "task",
  },
  {
    id: "subprocess",
    label: "子流程",
    bpmnType: "bpmn:CallActivity",
    className: "bpmn-icon-call-activity",
    group: "task",
  },
  {
    id: "exclusive",
    label: "排它网关",
    bpmnType: "bpmn:ExclusiveGateway",
    className: "bpmn-icon-gateway-xor",
    group: "gateway",
  },
  {
    id: "parallel",
    label: "并行网关",
    bpmnType: "bpmn:ParallelGateway",
    className: "bpmn-icon-gateway-parallel",
    group: "gateway",
  },
  {
    id: "timer",
    label: "定时",
    bpmnType: "bpmn:IntermediateCatchEvent",
    eventDefinitionType: "bpmn:TimerEventDefinition",
    className: "bpmn-icon-intermediate-event-catch-timer",
    group: "event",
  },
  {
    id: "end",
    label: "结束",
    bpmnType: "bpmn:EndEvent",
    className: "bpmn-icon-end-event-none",
    group: "event",
  },
]

/** 供 replaceElement 使用的目标描述 */
export function replaceTargetOf(node: BusinessNode): Record<string, unknown> {
  const target: Record<string, unknown> = { type: node.bpmnType }
  if (node.eventDefinitionType) target.eventDefinitionType = node.eventDefinitionType
  if (node.isExpanded !== undefined) target.isExpanded = node.isExpanded
  return target
}

/** 供 elementFactory.createShape 使用的属性 */
export function createAttrsOf(node: BusinessNode): Record<string, unknown> {
  return replaceTargetOf(node)
}

/**
 * 判断某业务节点是否就是元素当前的业务类型（用于「更改类型」排除自身）。
 * 事件类需比对 eventDefinitionType。
 */
export function isCurrentBusinessType(
  node: BusinessNode,
  bo: { $type: string; eventDefinitions?: Array<{ $type: string }> },
): boolean {
  if (node.bpmnType !== bo.$type) return false
  if (!node.eventDefinitionType) return true
  return bo.eventDefinitions?.[0]?.$type === node.eventDefinitionType
}
