/**
 * oa:<name> 独立元素 与 BPMN extensionElements 的双向序列化。
 *
 * 读：从 businessObject.extensionElements.values 里按类型找到各个 oa 元素，body 为 JSON/
 *     纯文本，逐个解析回配置对象；找不到任何新元素时回退旧版单块 `oa:NodeConfig` 并做值映射迁移。
 * 写：把最终配置计算成一份新的 extensionElements.values 数组（剔除所有本模块管理的旧元素，
 *     加入非空字段对应的新元素），一次性 `modeling.updateProperties`，避免多次调用互相覆盖。
 *
 * 为什么逐元素而不是单块 JSON：后端 `JsonToBpmnConverter`（Flowable JSON → BPMN XML）与运行时
 * `AssigneeResolver` 都是按 `oa:assigneeRules` / `oa:multiMode` / `oa:emptyStrategy` … 这些独立
 * 元素读取的；BPMN 设计器过去只写单块 `oa:NodeConfig`，导致 BPMN 原生定义的办理人在运行时从未真正
 * 解析生效——这里对齐后端契约，修复该隐藏 bug。
 */
import type { OrgRef } from "@/components/org-picker"
import type { AllowedOp, AssigneeRule, EmptyStrategy, HandleOptions, MultiMode, WfNodeProps } from "../../types"
import {
  defaultFlowConfig,
  defaultNodeConfig,
  type FlowConfig,
} from "./moddle"

/* ---------- 精简 moddle 服务类型（只收敛用到的部分） ---------- */

interface ModdleEl {
  $type: string
  value?: string
  multiMode?: string
  emptyStrategy?: string
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

/** 节点级 oa 元素名（逐个独立元素，$type 大写首字母 + tagAlias lowerCase → XML 标签首字母小写） */
const NODE_ELEMS = {
  assigneeRules: "oa:AssigneeRules",
  multiMode: "oa:MultiMode",
  emptyStrategy: "oa:EmptyStrategy",
  voteConfig: "oa:VoteConfig",
  allowedOps: "oa:AllowedOps",
  handleOptions: "oa:HandleOptions",
  auditMenu: "oa:AuditMenu",
  timeout: "oa:Timeout",
  formPerms: "oa:FormPerms",
  commentRequired: "oa:CommentRequired",
  events: "oa:Events",
  ccUsers: "oa:CcUsers",
} as const

const bodyOf = (bo: BusinessObjectLike, type: string): string | undefined => findOaElement(bo, type)?.value

function jsonOf<T>(bo: BusinessObjectLike, type: string): T | undefined {
  const v = bodyOf(bo, type)
  if (v == null) return undefined
  try {
    return JSON.parse(v) as T
  } catch {
    return undefined
  }
}

/* ---------- 旧版单块 oa:NodeConfig 迁移（值映射） ---------- */

const MULTI_MAP: Record<string, MultiMode> = {
  or: "ANY",
  and: "ALL",
  sequence: "SEQUENCE",
  ANY: "ANY",
  ALL: "ALL",
  SEQUENCE: "SEQUENCE",
  VOTE: "VOTE",
}
const EMPTY_MAP: Record<string, EmptyStrategy> = {
  skip: "AUTO_PASS",
  admin: "TO_ADMIN",
  toManager: "TO_ADMIN",
  initiator: "TO_ADMIN",
  AUTO_PASS: "AUTO_PASS",
  TO_ADMIN: "TO_ADMIN",
  BLOCK: "BLOCK",
}

/** 旧 oa:NodeConfig 单块 JSON → 新形状：枚举值映射 + 旧 OrgRef[] 办理人迁移为一条 ACCOUNT+FIXED 规则（showApprovalRecord 丢弃，WfNodeProps 无此字段） */
function migrateLegacyNode(parsed: Record<string, unknown>, base: WfNodeProps): WfNodeProps {
  const rawRules = Array.isArray(parsed.assigneeRules) ? (parsed.assigneeRules as unknown[]) : []
  // 旧 OrgRef[]（元素有 type/id 无 kind）→ 单条 ACCOUNT+FIXED 规则；已是新形状（有 kind）则直接使用
  const isLegacyRefs =
    rawRules.length > 0 &&
    rawRules.every((r) => r && typeof r === "object" && "type" in (r as object) && !("kind" in (r as object)))
  const assigneeRules: AssigneeRule[] = isLegacyRefs
    ? [{ kind: "ACCOUNT", source: "FIXED", refs: rawRules as OrgRef[] }]
    : (rawRules as AssigneeRule[])
  const { showApprovalRecord: _discard, ...rest } = parsed
  return {
    ...base,
    ...rest,
    assigneeRules,
    multiMode: MULTI_MAP[String(parsed.multiMode)] ?? base.multiMode,
    emptyStrategy: EMPTY_MAP[String(parsed.emptyStrategy)] ?? base.emptyStrategy,
    handleOptions: { ...base.handleOptions, ...(parsed.handleOptions as object) },
  } as WfNodeProps
}

/** 读取 UserTask 的办理人/多人模式/空值策略等配置；优先逐个独立元素，缺失才回退旧单块 oa:NodeConfig */
export function readNodeConfig(bo: BusinessObjectLike | undefined): WfNodeProps {
  const base = defaultNodeConfig()
  if (!bo) return base

  const hasNew = !!findOaElement(bo, NODE_ELEMS.assigneeRules) || !!findOaElement(bo, NODE_ELEMS.multiMode)
  if (hasNew) {
    return {
      ...base,
      assigneeRules: jsonOf<AssigneeRule[]>(bo, NODE_ELEMS.assigneeRules) ?? [],
      multiMode: (bodyOf(bo, NODE_ELEMS.multiMode) as MultiMode) ?? base.multiMode,
      emptyStrategy: (bodyOf(bo, NODE_ELEMS.emptyStrategy) as EmptyStrategy) ?? base.emptyStrategy,
      voteConfig: jsonOf(bo, NODE_ELEMS.voteConfig),
      ccUsers: jsonOf<OrgRef[]>(bo, NODE_ELEMS.ccUsers) ?? [],
      allowedOps: jsonOf<AllowedOp[]>(bo, NODE_ELEMS.allowedOps) ?? base.allowedOps,
      // jsonOf(...) 类型含 undefined；直接 spread 会令合并结果各字段被推断为 optional，
      // 故整体 as HandleOptions（JSON.parse 不会产出字段级 undefined，仅整块缺失/解析失败）
      handleOptions: { ...base.handleOptions, ...jsonOf(bo, NODE_ELEMS.handleOptions) } as HandleOptions,
      auditMenu: jsonOf(bo, NODE_ELEMS.auditMenu),
      timeout: jsonOf(bo, NODE_ELEMS.timeout),
      formPerms: jsonOf(bo, NODE_ELEMS.formPerms),
      commentRequired: jsonOf<boolean>(bo, NODE_ELEMS.commentRequired),
      events: jsonOf(bo, NODE_ELEMS.events),
    }
  }

  // 回退：旧 oa:NodeConfig 单块 JSON + 值映射迁移
  const el = findOaElement(bo, "oa:NodeConfig")
  if (!el?.value) return base
  try {
    return migrateLegacyNode(JSON.parse(el.value) as Record<string, unknown>, base)
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

interface ExtPatch {
  type: string
  /** undefined = 从 extensionElements 中删除该类型元素 */
  value: string | undefined
}

/**
 * 计算「应用 patches 后」的最终 extensionElements.values：
 * 先剔除所有 patches 涉及类型 + removeTypes（如旧版 oa:NodeConfig），保留其它扩展元素，
 * 再为非空 value 的 patch 各自 create 一个新元素并追加。仅返回数组，不做任何 modeling 调用，
 * 由调用方一次性 updateProperties —— 避免逐元素多次 updateProperties 互相覆盖（后一次会基于
 * 更新前的 businessObject 重新计算，抹掉前一次的写入）。
 */
function rebuildExtensions(
  bpmnFactory: BpmnFactoryLike,
  existing: ModdleEl[],
  patches: ExtPatch[],
  removeTypes: string[] = [],
): ModdleEl[] {
  const managedTypes = new Set<string>([...patches.map((p) => p.type), ...removeTypes])
  const kept = existing.filter((v) => !managedTypes.has(v.$type))
  const added = patches
    .filter((p): p is { type: string; value: string } => p.value !== undefined)
    .map((p) => bpmnFactory.create(p.type, { value: p.value }))
  return [...kept, ...added]
}

/** 把 patches 一次性落到 element 的 extensionElements 上（单次 updateProperties） */
function applyExtensions(
  modeling: ModelingLike,
  bpmnFactory: BpmnFactoryLike,
  element: ElementLike,
  patches: ExtPatch[],
  removeTypes: string[] = [],
): void {
  const existing = element.businessObject.extensionElements?.values ?? []
  const values = rebuildExtensions(bpmnFactory, existing, patches, removeTypes)
  const extensionElements = bpmnFactory.create("bpmn:ExtensionElements", { values })
  modeling.updateProperties(element, { extensionElements })
}

/**
 * 写入 UserTask 的办理人/多人模式/空值策略等配置：逐字段 upsert 独立元素，单次 updateProperties。
 * config（WfNodeProps）字段皆可选（与仿钉钉共享面板契约一致）——先与默认值合并，核心字段（assigneeRules/
 * multiMode/emptyStrategy/allowedOps/handleOptions/ccUsers）始终写出非 undefined 值。
 */
export function writeNodeConfig(
  modeling: ModelingLike,
  bpmnFactory: BpmnFactoryLike,
  element: ElementLike,
  config: WfNodeProps,
): void {
  const merged: WfNodeProps = { ...defaultNodeConfig(), ...config }
  const patches: ExtPatch[] = [
    { type: NODE_ELEMS.assigneeRules, value: JSON.stringify(merged.assigneeRules) },
    { type: NODE_ELEMS.multiMode, value: merged.multiMode },
    { type: NODE_ELEMS.emptyStrategy, value: merged.emptyStrategy },
    { type: NODE_ELEMS.voteConfig, value: merged.voteConfig ? JSON.stringify(merged.voteConfig) : undefined },
    { type: NODE_ELEMS.allowedOps, value: JSON.stringify(merged.allowedOps) },
    { type: NODE_ELEMS.handleOptions, value: JSON.stringify(merged.handleOptions) },
    { type: NODE_ELEMS.ccUsers, value: JSON.stringify(merged.ccUsers) },
    { type: NODE_ELEMS.auditMenu, value: merged.auditMenu ? JSON.stringify(merged.auditMenu) : undefined },
    { type: NODE_ELEMS.timeout, value: merged.timeout ? JSON.stringify(merged.timeout) : undefined },
    { type: NODE_ELEMS.formPerms, value: merged.formPerms ? JSON.stringify(merged.formPerms) : undefined },
    {
      type: NODE_ELEMS.commentRequired,
      value: merged.commentRequired != null ? String(merged.commentRequired) : undefined,
    },
    { type: NODE_ELEMS.events, value: merged.events ? JSON.stringify(merged.events) : undefined },
  ]
  // 迁移：清掉旧单块元素（与新元素一并计算，单次 updateProperties）
  applyExtensions(modeling, bpmnFactory, element, patches, ["oa:NodeConfig"])
}

/** 写入 Process 的 oa:FlowConfig */
export function writeFlowConfig(
  modeling: ModelingLike,
  bpmnFactory: BpmnFactoryLike,
  element: ElementLike,
  config: FlowConfig,
): void {
  applyExtensions(modeling, bpmnFactory, element, [{ type: "oa:FlowConfig", value: JSON.stringify(config) }])
}
