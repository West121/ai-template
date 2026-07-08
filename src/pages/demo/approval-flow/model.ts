/**
 * 仿钉钉审批流 demo 模型：核心数据模型/操作函数已抽至
 * src/pages/workflow/designer/dingtalk/model.ts 复用（流程定义设计器共用），
 * 这里保留 re-export 与 demo 专属的示例数据。
 */
import { newId, type ApprovalStep, type CcStep, type ConditionStep, type StepNode } from "@/pages/workflow/designer/dingtalk/model"

export {
  addBranch,
  createStep,
  findBranch,
  findStep,
  newId,
  removeBranch,
  removeStep,
  updateBranch,
  updateList,
  updateStep,
  type ApprovalStep,
  type Branch,
  type CcStep,
  type ConditionStep,
  type StepKind,
  type StepNode,
} from "@/pages/workflow/designer/dingtalk/model"

export const MOCK_USERS = ["赵天宇", "王小磊", "李思雨", "刘志强", "黄丽娟", "朱国栋", "杨慧敏", "谭凯文"]

export function initialSteps(): StepNode[] {
  const manager: ApprovalStep = { id: newId(), kind: "approval", name: "部门主管审批", assignees: ["赵天宇"], mode: "any" }
  const gm: ApprovalStep = { id: newId(), kind: "approval", name: "总经理审批", assignees: ["朱国栋"], mode: "all" }
  const condition: ConditionStep = {
    id: newId(),
    kind: "condition",
    name: "条件分支",
    branches: [
      { id: newId(), name: "条件 1", condition: "请假天数 > 3", steps: [gm] },
      { id: newId(), name: "默认条件", condition: "其他情况进入此分支", steps: [] },
    ],
  }
  const cc: CcStep = { id: newId(), kind: "cc", name: "抄送人", users: ["杨慧敏"] }
  return [manager, condition, cc]
}
