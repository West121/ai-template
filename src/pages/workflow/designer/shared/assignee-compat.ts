/**
 * 办理人规则（AssigneeRule）反序列化兼容 —— 跨设计器共用（DINGTALK / GRAPH 两条载入路径一致）。
 *
 * 背景：两维模型 `kind × source`（见 types.ts）。历史 / 后端种子 designerJson 常见旧形状：
 *  - 旧判别字段 `type`（ORG/LEADER/FORM_FIELD/INITIATOR），无 `kind`；
 *  - 已废弃 `kind`（ROLE_POST/UNIT/GROUP/SERVICE_API/FIND_LEADER/FORM_FIELD/FORMULA）；
 *  - 旧来源 `source=RELATED_TO_APPLICANT` + `sourceValue`。
 * 若载入路径不做归一化，`rule.kind` 为空 → 画布摘要 `summarizeAssignees` 吐 "undefined（N）"。
 *
 * 本模块把 dingtalk/serialize.ts 里验证过的兼容逻辑抽为共用，供 flow(GRAPH) 载入路径复用，
 * 杜绝"两套载入路径行为漂移"（正是该 bug 根因）。dingtalk 侧后续可迁移至此以彻底去重。
 */
import type { OrgRef, OrgRefType } from "@/components/org-picker"
import type { AssigneeKind, AssigneeRule, AssigneeSource } from "../types"

/** 后端组织引用（设计器产出 {kind,id}；种子可能 {kind?,username} 简写） */
export interface BackendOrgRef {
  kind?: OrgRefType
  /** 归一化后的 OrgRef 形状用 `type`；容忍二次归一化（幂等），避免 kind 缺失退化成 USER */
  type?: OrgRefType
  id?: number
  username?: string
  name?: string
}

/** 已废弃的旧办理人类型（仅反序列化兼容映射；含旧「来源型类型」FORM_FIELD/FORMULA，折叠到 ACCOUNT+来源） */
export type LegacyAssigneeKind =
  | "ROLE_POST"
  | "UNIT"
  | "GROUP"
  | "SERVICE_API"
  | "FIND_LEADER"
  | "FORM_FIELD"
  | "FORMULA"

/**
 * 后端 / 旧 designerJson 里的办理人规则（宽松读取）。兼容旧 `type` 判别字段、旧 `kind`、
 * 旧 `source=RELATED_TO_APPLICANT` + `sourceValue`。
 */
export interface BackendAssigneeRule {
  kind?: AssigneeKind | LegacyAssigneeKind
  /** 旧契约判别字段（仅反序列化兼容） */
  type?: "ORG" | "LEADER" | "FORM_FIELD" | "INITIATOR"
  refs?: BackendOrgRef[]
  /** 新契约值为 AssigneeSource，旧契约可能是 RELATED_TO_APPLICANT/SPECIFIED（按 string 读取） */
  source?: string
  sourceValue?: string
  level?: number
  postName?: string
  field?: string
  varName?: string
  formula?: string
  applicantValue?: "DEPT"
  fromNodeId?: string
  takeLeader?: boolean
  apiUrl?: string
}

const KIND_LABEL: Record<OrgRefType, string> = { USER: "成员", DEPT: "部门", ROLE: "角色" }

/** 设计器 AssigneeRule 的 OrgRef → 后端 {kind,id} */
export const orgRefToBackend = (r: OrgRef): BackendOrgRef => ({ kind: r.type, id: r.id })

/**
 * 回显：后端引用 → OrgRef。
 * - `{kind,id}`：id 回填，name 用占位（OrgPicker 打开后按 id 懒显示真实名）
 * - 种子简写 `{kind?,username}`（无 id）：以 username / name 作展示名，id 缺省为 0（只读回显）
 */
export const backendToOrgRef = (r: BackendOrgRef): OrgRef => {
  // 兼容后端 {kind} 与已归一化的 OrgRef {type}（幂等：二次归一化不把 ROLE/DEPT 退化成 USER）
  const type: OrgRefType = r.kind ?? r.type ?? "USER"
  if (typeof r.id === "number") {
    return { type, id: r.id, name: r.name ?? `${KIND_LABEL[type] ?? ""}#${r.id}` }
  }
  return { type, id: 0, name: r.name ?? r.username ?? `${KIND_LABEL[type] ?? ""}(未指定)` }
}

/** 旧 type 判别字段 → 新 kind */
const LEGACY_TYPE_TO_KIND: Record<NonNullable<BackendAssigneeRule["type"]>, AssigneeKind> = {
  ORG: "ACCOUNT",
  LEADER: "LEADER",
  FORM_FIELD: "ACCOUNT",
  INITIATOR: "INITIATOR",
}

/** 已废弃 kind → 新 kind（旧 designerJson 不崩） */
const LEGACY_KIND_TO_KIND: Record<LegacyAssigneeKind, AssigneeKind> = {
  ROLE_POST: "ROLE",
  UNIT: "DEPT",
  GROUP: "ACCOUNT",
  SERVICE_API: "ACCOUNT",
  FIND_LEADER: "LEADER",
  FORM_FIELD: "ACCOUNT",
  FORMULA: "ACCOUNT",
}

/** 归一化 kind：优先新 kind（含废弃 kind 映射），否则取旧 type 判别，兜底 ACCOUNT */
function normalizeKind(rule: BackendAssigneeRule): AssigneeKind {
  if (rule.kind) {
    if (rule.kind in LEGACY_KIND_TO_KIND) return LEGACY_KIND_TO_KIND[rule.kind as LegacyAssigneeKind]
    return rule.kind as AssigneeKind
  }
  return rule.type ? LEGACY_TYPE_TO_KIND[rule.type] : "ACCOUNT"
}

/** 新契约合法来源集合（剔除旧无效 source，如扁平编辑器的 "SPECIFIED"） */
const KNOWN_SOURCES = new Set<AssigneeSource>([
  "FIXED",
  "FORM_FIELD",
  "VARIABLE",
  "FORMULA",
  "APPLICANT",
  "PREV_HANDLER",
  "NODE_HANDLER",
])

/** 组织实体类型的默认来源：可选人的走 FIXED，快捷类型无来源 */
function defaultSourceForKind(kind: AssigneeKind): AssigneeSource | undefined {
  if (kind === "LEADER" || kind === "INITIATOR") return undefined
  return "FIXED"
}

/**
 * 旧扁平 / 后端规则 → 新 `{kind, source, ...}`（反序列化兼容；旧 designerJson 不重存也能加载）。
 * 对已是新契约的规则**幂等**（kind 已存在则原样归一，不变形）。
 */
export function ruleFromBackend(rule: BackendAssigneeRule): AssigneeRule {
  // 1) 旧 source=RELATED_TO_APPLICANT + sourceValue → 新形状
  if (rule.source === "RELATED_TO_APPLICANT") {
    switch (rule.sourceValue) {
      case "APPLICANT_DEPT":
        return { kind: "DEPT", source: "APPLICANT", applicantValue: "DEPT" }
      case "APPLICANT_DEPT_LEADER":
        return { kind: "LEADER", level: 1 }
      default:
        return { kind: "INITIATOR" }
    }
  }
  // 2) 归一化 kind（含旧 type 判别 + 废弃 kind）
  const kind = normalizeKind(rule)
  // 3) 旧「来源型类型」（FORM_FIELD/FORMULA）折叠到 账户+来源
  if (rule.kind === "FORM_FIELD" || rule.type === "FORM_FIELD") {
    return { kind: "ACCOUNT", source: "FORM_FIELD", field: rule.field }
  }
  if (rule.kind === "FORMULA") {
    return { kind: "ACCOUNT", source: "FORMULA", formula: rule.formula }
  }
  // 4) 新形状 or 旧组织实体（ACCOUNT/ROLE/POST/DEPT/LEADER/INITIATOR）
  const out: AssigneeRule = { kind }
  out.source =
    rule.source && KNOWN_SOURCES.has(rule.source as AssigneeSource)
      ? (rule.source as AssigneeSource)
      : defaultSourceForKind(kind)
  if (rule.refs) out.refs = rule.refs.map(backendToOrgRef)
  if (rule.postName) out.postName = rule.postName
  if (rule.field) out.field = rule.field
  if (rule.varName) out.varName = rule.varName
  if (rule.formula) out.formula = rule.formula
  if (rule.applicantValue) out.applicantValue = rule.applicantValue
  if (rule.fromNodeId) out.fromNodeId = rule.fromNodeId
  if (rule.takeLeader) out.takeLeader = rule.takeLeader
  if (typeof rule.level === "number") out.level = rule.level
  else if (kind === "LEADER") out.level = 1
  return out
}

/** 批量归一化一组办理人规则（载入路径用）；非数组安全回空 */
export function normalizeAssigneeRules(rules: unknown): AssigneeRule[] {
  if (!Array.isArray(rules)) return []
  return rules.map((r) => ruleFromBackend((r ?? {}) as BackendAssigneeRule))
}
