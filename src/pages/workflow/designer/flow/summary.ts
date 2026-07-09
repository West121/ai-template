/**
 * 画布节点/边的摘要文案（纯展示，供自定义节点/边组件调用）。
 * 复用共享元数据（ASSIGNEE_KIND_META / OPERATOR_META），与属性面板口径一致。
 */
import { ASSIGNEE_KIND_META } from "../shared/config"
import { OPERATOR_META, type AssigneeRule, type BranchCondition, type WfNodeProps } from "../types"

/** 审批人规则摘要：多条规则用「、」连接，空则提示未设置 */
export function summarizeAssignees(props?: WfNodeProps): string {
  const rules = props?.assigneeRules ?? []
  if (rules.length === 0) return "未设置审批人"
  return rules.map(ruleLabel).join("、")
}

function ruleLabel(rule: AssigneeRule): string {
  if (rule.kind === "LEADER") return `第 ${rule.level ?? 1} 级主管`
  if (rule.kind === "INITIATOR") return "发起人本人"
  const kind = ASSIGNEE_KIND_META[rule.kind]?.label ?? rule.kind
  if (rule.source && rule.source !== "FIXED") return `${kind}·动态`
  const count = rule.refs?.length ?? 0
  return count > 0 ? `${kind}（${count}）` : kind
}

/** 结构化条件摘要：`字段 运算符 值` 用逻辑词连接；默认分支/空条件各有提示 */
export function summarizeCondition(condition?: BranchCondition, isDefault?: boolean): string {
  if (isDefault) return "默认分支"
  if (!condition || condition.items.length === 0) return ""
  const joiner = condition.logic === "OR" ? " 或 " : " 且 "
  return condition.items.map((it) => `${it.field} ${OPERATOR_META[it.operator]} ${it.value}`).join(joiner)
}
