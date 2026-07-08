/**
 * 仿钉钉审批流 demo：画布核心（React Flow 布局/节点/插入边）已抽至
 * src/pages/workflow/designer/dingtalk/canvas.tsx 复用（流程定义设计器共用），
 * 本页保留原有可玩性：示例流程 + 节点配置抽屉（人名多选/或签会签/条件表达式）。
 */
import { useMemo, useState } from "react"
import { Copy, Download, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { Drawer } from "@/components/drawer"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { ApprovalFlowCanvas, type FlowActions } from "@/pages/workflow/designer/dingtalk/canvas"
import {
  MOCK_USERS,
  addBranch,
  createStep,
  findBranch,
  findStep,
  initialSteps,
  removeBranch,
  removeStep,
  updateBranch,
  updateList,
  updateStep,
  type StepNode,
} from "./model"

/* ---------- 人员多选 ---------- */

function UserPicker({ selected, onChange }: { selected: string[]; onChange: (users: string[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {MOCK_USERS.map((name) => {
        const checked = selected.includes(name)
        return (
          <label
            key={name}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 transition-colors",
              checked ? "border-primary/40 bg-primary/5" : "hover:bg-accent",
            )}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(next) => onChange(next ? [...selected, name] : selected.filter((n) => n !== name))}
            />
            <Avatar className="size-6">
              <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{name.charAt(0)}</AvatarFallback>
            </Avatar>
            <span className="text-sm">{name}</span>
          </label>
        )
      })}
    </div>
  )
}

/* ---------- 页面 ---------- */

type ConfigTarget = { type: "step"; id: string } | { type: "branch"; id: string } | null

export default function ApprovalFlowDemoPage() {
  const [steps, setSteps] = useState<StepNode[]>(initialSteps)
  const [configTarget, setConfigTarget] = useState<ConfigTarget>(null)

  // 抽屉草稿
  const [draftName, setDraftName] = useState("")
  const [draftUsers, setDraftUsers] = useState<string[]>([])
  const [draftMode, setDraftMode] = useState<"any" | "all">("any")
  const [draftCondition, setDraftCondition] = useState("")

  const actions = useMemo<FlowActions>(
    () => ({
      insert: (listId, index, kind) => {
        const step = createStep(kind)
        setSteps((prev) => updateList(prev, listId, (list) => [...list.slice(0, index), step, ...list.slice(index)]))
        toast.success(
          kind === "approval" ? "已添加审批节点" : kind === "cc" ? "已添加抄送节点" : "已添加条件分支",
        )
      },
      openStepConfig: (stepId) => {
        setSteps((prev) => {
          const step = findStep(prev, stepId)
          // demo 仅演示审批/抄送/条件三类；P3 高级节点（子流程/定时/触发/AI）在流程定义设计器中配置
          if (step && (step.kind === "approval" || step.kind === "cc")) {
            setDraftName(step.name)
            if (step.kind === "approval") {
              setDraftUsers(step.assignees)
              setDraftMode(step.mode)
            } else {
              setDraftUsers(step.users)
            }
            setConfigTarget({ type: "step", id: stepId })
          }
          return prev
        })
      },
      openBranchConfig: (branchId) => {
        setSteps((prev) => {
          const found = findBranch(prev, branchId)
          if (found) {
            setDraftName(found.branch.name)
            setDraftCondition(found.branch.condition)
            setConfigTarget({ type: "branch", id: branchId })
          }
          return prev
        })
      },
      deleteStep: (stepId) => {
        setSteps((prev) => removeStep(prev, stepId))
        toast.success("节点已删除")
      },
      deleteBranch: (conditionId, branchId) => {
        setSteps((prev) => removeBranch(prev, conditionId, branchId))
        toast.success("分支已删除")
      },
      addBranchTo: (conditionId) => {
        setSteps((prev) => addBranch(prev, conditionId))
        toast.success("已添加分支")
      },
    }),
    [],
  )

  const configStep = configTarget?.type === "step" ? findStep(steps, configTarget.id) : null
  const configBranch = configTarget?.type === "branch" ? findBranch(steps, configTarget.id) : null

  const saveConfig = () => {
    if (!configTarget) return
    if (configTarget.type === "step") {
      setSteps((prev) =>
        updateStep(prev, configTarget.id, (step) => {
          if (step.kind === "approval") {
            return { ...step, name: draftName || "审批人", assignees: draftUsers, mode: draftMode }
          }
          if (step.kind === "cc") {
            return { ...step, name: draftName || "抄送人", users: draftUsers }
          }
          return step
        }),
      )
    } else {
      setSteps((prev) =>
        updateBranch(prev, configTarget.id, (branch) => ({
          ...branch,
          name: draftName || branch.name,
          condition: draftCondition,
        })),
      )
    }
    setConfigTarget(null)
    toast.success("节点配置已保存")
  }

  const exportJson = () => {
    const json = JSON.stringify(steps, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "approval-flow.json"
    link.click()
    URL.revokeObjectURL(url)
    toast.success("已导出流程 JSON")
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="审批流设计器"
        description="基于 React Flow 的仿钉钉审批流 · 点击连线上的 + 插入节点 · 点击卡片配置 · 支持条件分支嵌套"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setSteps(initialSteps())
                toast.success("已重置为示例流程")
              }}
            >
              <RotateCcw className="size-3.5" />
              重置
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportJson}>
              <Download className="size-3.5" />
              导出 JSON
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                console.log(JSON.stringify(steps, null, 2))
                toast.success("流程已保存，JSON 已输出到控制台")
              }}
            >
              <Save className="size-3.5" />
              保存
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden p-0">
        <div className="h-[calc(100vh-300px)] min-h-[560px]">
          <ApprovalFlowCanvas steps={steps} actions={actions} />
        </div>
      </Card>

      {/* 节点配置抽屉 */}
      <Drawer
        open={!!configTarget}
        onOpenChange={(open) => !open && setConfigTarget(null)}
        title={
          configTarget?.type === "branch"
            ? "条件配置"
            : configStep?.kind === "approval"
              ? "审批人配置"
              : "抄送人配置"
        }
        description={configTarget?.type === "branch" ? "设置分支名称与条件表达式" : "设置节点名称与人员"}
        width={420}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfigTarget(null)}>
              取消
            </Button>
            <Button onClick={saveConfig}>保存</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs">节点名称</Label>
            <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="请输入节点名称" />
          </div>

          {configTarget?.type === "step" && configStep && configStep.kind !== "condition" && (
            <>
              <div className="space-y-2">
                <Label className="text-xs">{configStep.kind === "approval" ? "审批人" : "抄送人"}</Label>
                <UserPicker selected={draftUsers} onChange={setDraftUsers} />
              </div>
              {configStep.kind === "approval" && (
                <div className="space-y-2">
                  <Label className="text-xs">多人审批方式</Label>
                  <RadioGroup
                    value={draftMode}
                    onValueChange={(v) => setDraftMode(v as "any" | "all")}
                    className="gap-2"
                  >
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3 transition-colors hover:bg-accent has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5">
                      <RadioGroupItem value="any" className="mt-0.5" />
                      <span>
                        <span className="block text-sm font-medium">或签</span>
                        <span className="block text-xs text-muted-foreground">一名审批人同意即可通过</span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3 transition-colors hover:bg-accent has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5">
                      <RadioGroupItem value="all" className="mt-0.5" />
                      <span>
                        <span className="block text-sm font-medium">会签</span>
                        <span className="block text-xs text-muted-foreground">需所有审批人同意才能通过</span>
                      </span>
                    </label>
                  </RadioGroup>
                </div>
              )}
            </>
          )}

          {configTarget?.type === "branch" && configBranch && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">条件表达式</Label>
                <Textarea
                  value={draftCondition}
                  onChange={(e) => setDraftCondition(e.target.value)}
                  placeholder="如：请假天数 > 3"
                  rows={3}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  <Copy className="mr-1 inline size-3" />
                  优先级 {configBranch.index + 1}
                  ：流程按分支优先级从左到右依次匹配，命中即进入该分支
                </p>
              </div>
            </>
          )}
        </div>
      </Drawer>
    </div>
  )
}
