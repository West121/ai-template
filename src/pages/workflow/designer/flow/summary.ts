/**
 * 画布节点/边的摘要文案（纯展示，供自定义节点/边组件调用）。
 * 复用共享元数据（ASSIGNEE_KIND_META / OPERATOR_META），与属性面板口径一致。
 */
import { ASSIGNEE_KIND_META } from "../shared/config"
import { OPERATOR_META, type AssigneeRule, type BranchCondition, type WfNodeProps } from "../types"
import type {
  AiConfig,
  CallActivityConfig,
  ServiceTaskConfig,
  TimerConfig,
  WebhookConfig,
} from "./model"

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

/** 抄送人摘要 */
export function summarizeCc(props?: WfNodeProps): string {
  const n = props?.ccUsers?.length ?? 0
  return n > 0 ? `抄送 ${n} 个对象` : "未设置抄送人"
}

/** 服务任务实现摘要（autoApprove/autoReject/trigger/delegate） */
export function summarizeService(service?: ServiceTaskConfig): string {
  if (!service) return "未配置"
  switch (service.impl) {
    case "autoApprove":
      return "自动通过"
    case "autoReject":
      return "自动驳回"
    case "trigger":
      return service.triggerType === "TIMER" ? "定时触发器" : "即时触发器"
    case "delegate":
      return service.delegateExpression ? service.delegateExpression : "未配置委托"
  }
}

/** AI 审批摘要 */
export function summarizeAi(ai?: AiConfig): string {
  if (!ai || !ai.model) return "未配置模型"
  return `模型 ${ai.model}`
}

/** Webhook 摘要 */
export function summarizeWebhook(webhook?: WebhookConfig): string {
  return webhook?.url ? webhook.url : "未配置回调地址"
}

/** 定时摘要（duration/date/cycle） */
export function summarizeTimer(timer?: TimerConfig): string {
  if (!timer || !timer.value) return "未配置时间"
  const modeLabel = timer.mode === "duration" ? "时长" : timer.mode === "date" ? "日期" : "周期"
  return `${modeLabel} ${timer.value}`
}

/** 子流程调用摘要 */
export function summarizeCallActivity(cfg?: CallActivityConfig): string {
  if (!cfg || !cfg.calledElement) return "未选择子流程"
  return `${cfg.calledElement}${cfg.async ? "（异步）" : "（同步）"}`
}

/** 结构化条件摘要：`字段 运算符 值` 用逻辑词连接；默认分支/空条件各有提示 */
export function summarizeCondition(condition?: BranchCondition, isDefault?: boolean): string {
  if (isDefault) return "默认分支"
  if (!condition || condition.items.length === 0) return ""
  const joiner = condition.logic === "OR" ? " 或 " : " 且 "
  return condition.items.map((it) => `${it.field} ${OPERATOR_META[it.operator]} ${it.value}`).join(joiner)
}
