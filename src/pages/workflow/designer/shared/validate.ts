/**
 * 发布校验（通用规则，仿钉钉 StepNode 树适配）。
 *
 * validateFlow(steps, nodeProps) → ValidationIssue[]：
 *  - 唯一开始 / 可达结束（仿钉钉线性树结构天然保证；空流程报错）
 *  - 审批节点必配办理人（assigneeRules 非空）
 *  - 条件分支：必须有默认分支；非默认分支必须配条件；无悬空（空）分支
 *  - 抄送节点必配抄送人（warn）
 *  - 高级节点必要字段（子流程 defCode / 定时 value / 触发器 handler|webhook）
 *
 * BPMN 设计器可另建适配器复用同一 ValidationIssue 结构（见 docs/flow-designer-v2.md「发布校验」节）。
 */
import type { NodePropsMap } from "../types"
import type { StepNode } from "../dingtalk/model"

export type ValidationLevel = "error" | "warn"

export interface ValidationIssue {
  /** 关联的节点 / 分支 id（无则为流程级问题） */
  nodeId?: string
  level: ValidationLevel
  message: string
}

/** 仿钉钉模型发布校验 */
export function validateFlow(steps: StepNode[], nodeProps: NodePropsMap): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (steps.length === 0) {
    issues.push({ level: "error", message: "流程为空：开始与结束之间至少需要一个节点" })
    return issues
  }

  const walk = (list: StepNode[]) => {
    for (const step of list) {
      switch (step.kind) {
        case "approval": {
          const rules = nodeProps[step.id]?.assigneeRules ?? []
          const hasValid =
            rules.length > 0 &&
            rules.some((r) => {
              // 快捷类型（发起人主管/发起人本人）：无需额外配置
              if (r.kind === "LEADER" || r.kind === "INITIATOR") return true
              if (r.kind === "POST") return !!r.postName
              switch (r.source) {
                case "FORM_FIELD":
                  return !!r.field
                case "VARIABLE":
                  return !!r.varName
                case "FORMULA":
                  return !!r.formula
                case "NODE_HANDLER":
                  return !!r.fromNodeId
                case "APPLICANT":
                case "PREV_HANDLER":
                  return true
                default:
                  // FIXED（账户/角色/部门）：需 OrgPicker 选人非空
                  return (r.refs?.length ?? 0) > 0
              }
            })
          if (!hasValid) {
            issues.push({
              nodeId: step.id,
              level: "error",
              message: `审批节点「${step.name}」未配置有效办理人`,
            })
          }
          break
        }
        case "cc": {
          const users = nodeProps[step.id]?.ccUsers ?? []
          if (users.length === 0) {
            issues.push({ nodeId: step.id, level: "warn", message: `抄送节点「${step.name}」未选择抄送人` })
          }
          break
        }
        case "parallel": {
          step.branches.forEach((branch) => {
            if (branch.steps.length === 0) {
              issues.push({
                nodeId: branch.id,
                level: "warn",
                message: `并行分支「${branch.name}」下无节点（空分支将直接汇聚）`,
              })
            }
            walk(branch.steps)
          })
          break
        }
        case "inclusive":
        case "condition": {
          const branches = step.branches
          const lastCond = branches.length ? nodeProps[branches[branches.length - 1].id]?.condition : undefined
          const hasDefault =
            branches.length > 0 && (lastCond?.isDefault ?? true)
          if (!hasDefault) {
            issues.push({
              nodeId: step.id,
              level: "error",
              message: `条件分支「${step.name}」缺少默认分支（所有条件都不满足时无出口）`,
            })
          }
          branches.forEach((branch, index) => {
            const isDefault = index === branches.length - 1
            const cond = nodeProps[branch.id]?.condition
            if (!isDefault && (!cond || cond.items.length === 0)) {
              issues.push({
                nodeId: branch.id,
                level: "error",
                message: `分支「${branch.name}」未配置条件`,
              })
            }
            if (branch.steps.length === 0) {
              issues.push({
                nodeId: branch.id,
                level: "warn",
                message: `分支「${branch.name}」下无节点（空分支将直接汇聚）`,
              })
            }
            walk(branch.steps)
          })
          break
        }
        case "subprocess": {
          if (!step.defCode) {
            issues.push({ nodeId: step.id, level: "error", message: `子流程「${step.name}」未指定子流程定义编码` })
          }
          break
        }
        case "timer": {
          if (!step.value) {
            issues.push({ nodeId: step.id, level: "error", message: `定时节点「${step.name}」未设置时间` })
          }
          break
        }
        case "trigger": {
          if (!step.handler && !step.webhookUrl) {
            issues.push({
              nodeId: step.id,
              level: "warn",
              message: `触发器「${step.name}」未配置处理器或 Webhook`,
            })
          }
          break
        }
        case "ai": {
          if (!step.systemPrompt) {
            issues.push({ nodeId: step.id, level: "warn", message: `AI 审批「${step.name}」未配置系统提示词` })
          }
          break
        }
      }
    }
  }

  walk(steps)
  return issues
}

/** 是否存在阻止发布的 error */
export function hasBlockingIssue(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error")
}
