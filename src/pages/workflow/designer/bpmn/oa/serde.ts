/**
 * oa:nodeConfig / oa:flowConfig 与 BPMN extensionElements 的双向序列化。
 *
 * 读：从 businessObject.extensionElements.values 里找到 oa 元素，解析 body JSON → 配置对象。
 * 写：用 bpmnFactory 造 extensionElements + oa 元素，经 modeling.updateProperties 落到画布，
 *     saveXML() 时即随 XML 输出，实现真持久化。
 */
import {
  defaultFlowConfig,
  defaultNodeConfig,
  type FlowConfig,
  type NodeConfig,
} from "./moddle"

/* ---------- 精简 moddle 服务类型（只收敛用到的部分） ---------- */

interface ModdleEl {
  $type: string
  value?: string
  multiMode?: string
  emptyStrategy?: string
  showApprovalRecord?: boolean
  extensionElements?: { values?: ModdleEl[] } | undefined
  [key: string]: unknown
}

interface BusinessObjectLike {
  $type: string
  extensionElements?: { values?: ModdleEl[] } | undefined
  [key: string]: unknown
}

export interface ElementLike {
  id: string
  type: string
  businessObject: BusinessObjectLike
}

export interface ModelingLike {
  updateProperties(element: ElementLike, props: Record<string, unknown>): void
}

export interface BpmnFactoryLike {
  create(type: string, props?: Record<string, unknown>): ModdleEl
}

/* ---------- 读 ---------- */

function findOaElement(bo: BusinessObjectLike, type: string): ModdleEl | undefined {
  return bo.extensionElements?.values?.find((v) => v.$type === type)
}

/** 读取 UserTask 的 oa:NodeConfig；无则返回默认 */
export function readNodeConfig(bo: BusinessObjectLike | undefined): NodeConfig {
  const base = defaultNodeConfig()
  if (!bo) return base
  const el = findOaElement(bo, "oa:NodeConfig")
  if (!el?.value) return base
  try {
    const parsed = JSON.parse(el.value) as Partial<NodeConfig>
    return {
      ...base,
      ...parsed,
      handleOptions: { ...base.handleOptions, ...parsed.handleOptions },
    }
  } catch {
    return base
  }
}

/** 读取 Process 的 oa:FlowConfig；无则返回默认 */
export function readFlowConfig(bo: BusinessObjectLike | undefined): FlowConfig {
  const base = defaultFlowConfig()
  if (!bo) return base
  const el = findOaElement(bo, "oa:FlowConfig")
  if (!el?.value) return base
  try {
    const parsed = JSON.parse(el.value) as Partial<FlowConfig>
    return {
      ...base,
      ...parsed,
      operations: { ...base.operations, ...parsed.operations },
      start: { ...base.start, ...parsed.start },
    }
  } catch {
    return base
  }
}

/* ---------- 写 ---------- */

/** 用新的 oa 元素替换 extensionElements 中的同类型元素，保留其它扩展元素 */
function upsertExtension(
  modeling: ModelingLike,
  bpmnFactory: BpmnFactoryLike,
  element: ElementLike,
  oaType: string,
  oaEl: ModdleEl,
): void {
  const existing = element.businessObject.extensionElements?.values ?? []
  const kept = existing.filter((v) => v.$type !== oaType)
  const extensionElements = bpmnFactory.create("bpmn:ExtensionElements", {
    values: [...kept, oaEl],
  })
  modeling.updateProperties(element, { extensionElements })
}

/** 写入 UserTask 的 oa:NodeConfig（标量落属性 + 全量 JSON 落 body） */
export function writeNodeConfig(
  modeling: ModelingLike,
  bpmnFactory: BpmnFactoryLike,
  element: ElementLike,
  config: NodeConfig,
): void {
  const oaEl = bpmnFactory.create("oa:NodeConfig", {
    multiMode: config.multiMode,
    emptyStrategy: config.emptyStrategy,
    showApprovalRecord: config.showApprovalRecord,
    value: JSON.stringify(config),
  })
  upsertExtension(modeling, bpmnFactory, element, "oa:NodeConfig", oaEl)
}

/** 写入 Process 的 oa:FlowConfig */
export function writeFlowConfig(
  modeling: ModelingLike,
  bpmnFactory: BpmnFactoryLike,
  element: ElementLike,
  config: FlowConfig,
): void {
  const oaEl = bpmnFactory.create("oa:FlowConfig", {
    value: JSON.stringify(config),
  })
  upsertExtension(modeling, bpmnFactory, element, "oa:FlowConfig", oaEl)
}
