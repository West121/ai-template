/**
 * 仿钉钉审批流数据模型（从 demo/approval-flow 抽出的可复用核心）：
 * 线性步骤 + 可递归嵌套的条件分支。
 *
 * 该结构即流程定义 designerJson.root（沿用原 demo 的 FlowNode 模型）；
 * 工作流的节点扩展属性（审批人规则/多人模式/抄送/结构化条件）单独挂在
 * designerJson.nodeProps[nodeId]，见 ../types.ts。
 */

export interface ApprovalStep {
  id: string
  kind: "approval"
  name: string
  assignees: string[]
  /** any 或签（一人同意即可）/ all 会签（需全员同意） */
  mode: "any" | "all"
}

export interface CcStep {
  id: string
  kind: "cc"
  name: string
  users: string[]
}

/* ---------------- P3 高级节点类型（配置内联在节点上，序列化进 designerJson 供后端转换器读取） ---------------- */

/** 子流程：同步 CallActivity / 异步并行旁路；paramMap 子变量←父字段 */
export interface SubprocessStep {
  id: string
  kind: "subprocess"
  name: string
  /** 子流程定义编码 */
  defCode: string
  /** true=异步（并行旁路+信号回写）；false=同步（阻塞主流程） */
  async: boolean
  /** 参数映射：子流程变量名 ← 父流程表单字段 key */
  paramMap: { child: string; parent: string }[]
}

/** 定时：intermediateCatchEvent(timerEventDefinition)，到点进入下一步 */
export interface TimerStep {
  id: string
  kind: "timer"
  name: string
  /** duration=相对时长（ISO8601 如 PT1H / P1D）；date=绝对日期时间 */
  mode: "duration" | "date"
  value: string
}

/** 触发：serviceTask→TriggerDelegate，执行业务逻辑后进入下一步 */
export interface TriggerStep {
  id: string
  kind: "trigger"
  name: string
  /** IMMEDIATE=立即触发；TIMER=前置定时后触发 */
  triggerType: "IMMEDIATE" | "TIMER"
  /** 已注册触发器 bean 名（与 webhookUrl 二选一） */
  handler?: string
  /** WEBHOOK 触发地址（与 handler 二选一） */
  webhookUrl?: string
  /** triggerType=TIMER 时的定时表达式（ISO8601 duration / 日期） */
  timer?: string
}

/** AI 审批：serviceTask→AiApprovalDelegate，按配置智能路由/辅助审批 */
export interface AiStep {
  id: string
  kind: "ai"
  name: string
  /** 模型标识（无 key 时后端降级规则模拟） */
  model: string
  /** 系统提示词 */
  systemPrompt: string
  /** 注入 AI 上下文的表单字段 key 列表 */
  formContext: string[]
  /** 输出映射：AI 结果写入的流程变量名 */
  outputMap: {
    /** 决策变量（值域 approve|reject|route） */
    decision: string
    /** 审批意见变量 */
    comment: string
    /** 路由目标变量（decision=route 时生效） */
    route?: string
  }
}

/** 自动通过：serviceTask 语义，到达即自动 complete（记录 action=AUTO_APPROVE） */
export interface AutoApproveStep {
  id: string
  kind: "autoApprove"
  name: string
}

/** 自动拒绝：serviceTask 语义，到达即自动 reject（常配合条件分支做自动驳回） */
export interface AutoRejectStep {
  id: string
  kind: "autoReject"
  name: string
}

export interface Branch {
  id: string
  name: string
  condition: string
  steps: StepNode[]
}

/** 条件分支（排他网关）：命中优先级最高的一条，最后一条为默认分支 */
export interface ConditionStep {
  id: string
  kind: "condition"
  name: string
  branches: Branch[]
}

/** 包容分支（包容网关）：满足的多条分支都走，全不满足走默认分支（最后一条） */
export interface InclusiveStep {
  id: string
  kind: "inclusive"
  name: string
  branches: Branch[]
}

/** 并行分支（并行网关）：fork 全部分支并行 → join 汇聚，无条件 */
export interface ParallelStep {
  id: string
  kind: "parallel"
  name: string
  branches: Branch[]
}

/** 叶子（非分支）节点：审批/抄送/子流程/定时/触发/AI/自动通过/自动拒绝 */
export type LeafStep =
  | ApprovalStep
  | CcStep
  | SubprocessStep
  | TimerStep
  | TriggerStep
  | AiStep
  | AutoApproveStep
  | AutoRejectStep
/** 含子分支的容器节点：条件 / 包容 / 并行 */
export type BranchContainerStep = ConditionStep | InclusiveStep | ParallelStep
export type StepNode = LeafStep | BranchContainerStep
export type StepKind = StepNode["kind"]

/** 是否为含子分支的容器节点（条件/包容/并行）——统一递归遍历用 */
export function isBranchContainer(step: StepNode): step is BranchContainerStep {
  return step.kind === "condition" || step.kind === "inclusive" || step.kind === "parallel"
}

let uid = 0
export const newId = () => `n${++uid}`

/** 载入既有 designerJson 后调用：把 id 计数器抬到已用序号之后，避免新节点 id 冲突 */
export function ensureNodeIdSeq(steps: StepNode[]) {
  const walk = (list: StepNode[]) => {
    for (const step of list) {
      const bump = (id: string) => {
        const match = /^n(\d+)$/.exec(id)
        if (match) uid = Math.max(uid, Number(match[1]))
      }
      bump(step.id)
      if (isBranchContainer(step)) {
        for (const branch of step.branches) {
          bump(branch.id)
          walk(branch.steps)
        }
      }
    }
  }
  walk(steps)
}

export function createStep(kind: StepKind): StepNode {
  if (kind === "approval") {
    return { id: newId(), kind, name: "审批人", assignees: [], mode: "any" }
  }
  if (kind === "cc") {
    return { id: newId(), kind, name: "抄送人", users: [] }
  }
  if (kind === "subprocess") {
    return { id: newId(), kind, name: "子流程", defCode: "", async: false, paramMap: [] }
  }
  if (kind === "timer") {
    return { id: newId(), kind, name: "定时等待", mode: "duration", value: "" }
  }
  if (kind === "trigger") {
    return { id: newId(), kind, name: "触发器", triggerType: "IMMEDIATE", handler: "" }
  }
  if (kind === "ai") {
    return {
      id: newId(),
      kind,
      name: "AI 审批",
      model: "",
      systemPrompt: "",
      formContext: [],
      outputMap: { decision: "aiDecision", comment: "aiComment" },
    }
  }
  if (kind === "autoApprove") {
    return { id: newId(), kind, name: "自动通过" }
  }
  if (kind === "autoReject") {
    return { id: newId(), kind, name: "自动拒绝" }
  }
  if (kind === "inclusive") {
    return {
      id: newId(),
      kind: "inclusive",
      name: "包容分支",
      branches: [
        { id: newId(), name: "条件 1", condition: "", steps: [] },
        { id: newId(), name: "默认条件", condition: "其他情况进入此分支", steps: [] },
      ],
    }
  }
  if (kind === "parallel") {
    return {
      id: newId(),
      kind: "parallel",
      name: "并行分支",
      branches: [
        { id: newId(), name: "并行分支 1", condition: "", steps: [] },
        { id: newId(), name: "并行分支 2", condition: "", steps: [] },
      ],
    }
  }
  return {
    id: newId(),
    kind: "condition",
    name: "条件分支",
    branches: [
      { id: newId(), name: "条件 1", condition: "", steps: [] },
      { id: newId(), name: "默认条件", condition: "其他情况进入此分支", steps: [] },
    ],
  }
}

type ListUpdater = (list: StepNode[]) => StepNode[]

/** 对 listId（"root" 或某个 branch.id）对应的步骤数组做不可变更新 */
export function updateList(steps: StepNode[], listId: string, updater: ListUpdater): StepNode[] {
  if (listId === "root") return updater(steps)
  const walk = (list: StepNode[]): StepNode[] =>
    list.map((step) => {
      if (!isBranchContainer(step)) return step
      return {
        ...step,
        branches: step.branches.map((branch) =>
          branch.id === listId
            ? { ...branch, steps: updater(branch.steps) }
            : { ...branch, steps: walk(branch.steps) },
        ),
      }
    })
  return walk(steps)
}

/** 按 id 更新某个步骤节点 */
export function updateStep(steps: StepNode[], stepId: string, updater: (step: StepNode) => StepNode): StepNode[] {
  return steps.map((step) => {
    if (step.id === stepId) return updater(step)
    if (!isBranchContainer(step)) return step
    return {
      ...step,
      branches: step.branches.map((branch) => ({ ...branch, steps: updateStep(branch.steps, stepId, updater) })),
    }
  })
}

/** 按 id 删除步骤节点（含条件分支整体删除） */
export function removeStep(steps: StepNode[], stepId: string): StepNode[] {
  return steps
    .filter((step) => step.id !== stepId)
    .map((step) =>
      isBranchContainer(step)
        ? { ...step, branches: step.branches.map((b) => ({ ...b, steps: removeStep(b.steps, stepId) })) }
        : step,
    )
}

export function updateBranch(steps: StepNode[], branchId: string, updater: (branch: Branch) => Branch): StepNode[] {
  return steps.map((step) => {
    if (!isBranchContainer(step)) return step
    return {
      ...step,
      branches: step.branches.map((branch) =>
        branch.id === branchId
          ? updater(branch)
          : { ...branch, steps: updateBranch(branch.steps, branchId, updater) },
      ),
    }
  })
}

export function addBranch(steps: StepNode[], conditionId: string): StepNode[] {
  return updateStep(steps, conditionId, (step) => {
    if (!isBranchContainer(step)) return step
    if (step.kind === "parallel") {
      // 并行分支无默认分支，直接追加
      const branch: Branch = { id: newId(), name: `并行分支 ${step.branches.length + 1}`, condition: "", steps: [] }
      return { ...step, branches: [...step.branches, branch] }
    }
    // 条件 / 包容：新分支插入在「默认条件」之前
    const branch: Branch = { id: newId(), name: `条件 ${step.branches.length}`, condition: "", steps: [] }
    return { ...step, branches: [...step.branches.slice(0, -1), branch, step.branches[step.branches.length - 1]] }
  })
}

export function removeBranch(steps: StepNode[], conditionId: string, branchId: string): StepNode[] {
  return updateStep(steps, conditionId, (step) => {
    if (!isBranchContainer(step) || step.branches.length <= 2) return step
    return { ...step, branches: step.branches.filter((b) => b.id !== branchId) }
  })
}

export function findStep(steps: StepNode[], stepId: string): StepNode | null {
  for (const step of steps) {
    if (step.id === stepId) return step
    if (isBranchContainer(step)) {
      for (const branch of step.branches) {
        const found = findStep(branch.steps, stepId)
        if (found) return found
      }
    }
  }
  return null
}

export function findBranch(
  steps: StepNode[],
  branchId: string,
): { branch: Branch; condition: BranchContainerStep; index: number } | null {
  for (const step of steps) {
    if (!isBranchContainer(step)) continue
    const index = step.branches.findIndex((b) => b.id === branchId)
    if (index >= 0) return { branch: step.branches[index], condition: step, index }
    for (const branch of step.branches) {
      const found = findBranch(branch.steps, branchId)
      if (found) return found
    }
  }
  return null
}

/** 收集流程树中所有节点/分支 id（用于清理 nodeProps 中的孤儿配置） */
export function collectNodeIds(steps: StepNode[]): Set<string> {
  const ids = new Set<string>()
  const walk = (list: StepNode[]) => {
    for (const step of list) {
      ids.add(step.id)
      if (isBranchContainer(step)) {
        for (const branch of step.branches) {
          ids.add(branch.id)
          walk(branch.steps)
        }
      }
    }
  }
  walk(steps)
  return ids
}
