/**
 * 仿钉钉流程定义设计器：画布（复用 canvas.tsx）+ 右侧固定共享属性面板（shared/property-panel）。
 *
 * 选中态：
 *  - 点画布空白 → 流程级属性（基础信息 / 流程操作开关 / 流程启动 / 安全·其他）
 *  - 点审批/抄送/条件分支节点 → 共享属性面板对应分区（审批人+按钮操作白名单 / 抄送人 / 结构化条件）
 *  - 点高级节点（子流程/定时/触发/AI）→ 本设计器专属内联编辑器（非共享面板范畴）
 *
 * 属性实时回写：审批/抄送/条件写 nodeProps；节点名与高级节点配置写 StepNode。
 * 流程级 base（名称/说明/图标/分类）映射 ProcessDef 顶层列；flowConfig 序列化进 designerJson.flowConfig。
 */
import { useCallback, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react"
import { Bot, CircleCheck, CircleX, Plus, Timer, Trash2, Workflow, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  MULTI_MODE_META,
  OPERATOR_META,
  type AssigneeRule,
  type BranchCondition,
  type NodePropsMap,
  type WfNodeProps,
} from "../types"
import { PropertyPanel } from "../shared/property-panel"
import { ASSIGNEE_KIND_META } from "../shared/config"
import type { FlowConfig, FormFieldOption, ProcessBase, ProcessConfig } from "../shared/config"
import { ApprovalFlowCanvas, type ContainerKind, type FlowActions } from "./canvas"
import {
  addBranch,
  collectNodeIds,
  createStep,
  findBranch,
  findStep,
  isBranchContainer,
  removeBranch,
  removeStep,
  updateBranch,
  updateList,
  updateStep,
  type AiStep,
  type AutoApproveStep,
  type AutoRejectStep,
  type Branch,
  type LeafStep,
  type StepNode,
  type SubprocessStep,
  type TimerStep,
  type TriggerStep,
} from "./model"

/** 绑定表单可用字段（供条件/表单字段规则选择）——从 shared/config 复用并再导出，保持既有引用兼容 */
export type { FormFieldOption } from "../shared/config"

/* ---------- 摘要（画布卡片内） ---------- */

function ruleSummaryText(rules: AssigneeRule[] | undefined, fields: FormFieldOption[]): string {
  if (!rules || rules.length === 0) return ""
  return rules
    .map((rule) => {
      switch (rule.kind) {
        case "LEADER":
          return `第 ${rule.level ?? 1} 级主管`
        case "POST":
          return `岗位：${rule.postName || "(未填)"}`
        case "FORM_FIELD":
          return `表单：${fields.find((f) => f.key === rule.field)?.label ?? rule.field ?? ""}`
        case "INITIATOR":
          return "发起人本人"
        case "FORMULA":
          return `公式：${rule.formula || "(未填)"}`
        default: {
          const label = ASSIGNEE_KIND_META[rule.kind]?.label ?? "办理人"
          if (rule.source === "RELATED_TO_APPLICANT") return `${label}·与申请人相关`
          return rule.refs?.length ? rule.refs.map((r) => r.name).join("、") : `${label}(未选)`
        }
      }
    })
    .join("；")
}

function conditionSummaryText(condition: BranchCondition | undefined, fields: FormFieldOption[]): string {
  if (!condition) return ""
  if (condition.isDefault) return ""
  if (condition.items.length === 0) return ""
  const join = condition.logic === "AND" ? " 且 " : " 或 "
  return condition.items
    .map((item) => {
      const label = fields.find((f) => f.key === item.field)?.label ?? item.field
      return `${label} ${OPERATOR_META[item.operator]} ${item.value || "?"}`
    })
    .join(join)
}

function leafSummaryText(step: LeafStep): string {
  switch (step.kind) {
    case "subprocess":
      return step.defCode ? `子流程 ${step.defCode}${step.async ? " · 异步" : " · 同步"}` : ""
    case "timer":
      return step.value ? (step.mode === "duration" ? `等待 ${step.value}` : `到 ${step.value}`) : ""
    case "trigger": {
      const target = step.triggerType === "TIMER" ? "定时触发" : "立即触发"
      const to = step.webhookUrl || step.handler
      return to ? `${target} · ${to}` : target
    }
    case "ai":
      return step.model
        ? `模型 ${step.model}${step.formContext.length ? ` · ${step.formContext.length} 字段` : ""}`
        : ""
    default:
      return ""
  }
}

/* ---------- P3 高级节点：属性编辑器（本设计器专属，非共享面板范畴） ---------- */

/** 子流程：定义编码 + 同步/异步 + 参数映射（子变量 ← 父字段） */
function SubprocessEditor({
  step,
  onChange,
  fields,
}: {
  step: SubprocessStep
  onChange: (step: SubprocessStep) => void
  fields: FormFieldOption[]
}) {
  const addMap = () => onChange({ ...step, paramMap: [...step.paramMap, { child: "", parent: fields[0]?.key ?? "" }] })
  const updateMap = (index: number, next: { child: string; parent: string }) =>
    onChange({ ...step, paramMap: step.paramMap.map((m, i) => (i === index ? next : m)) })
  const removeMap = (index: number) => onChange({ ...step, paramMap: step.paramMap.filter((_, i) => i !== index) })

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">子流程定义编码</Label>
        <Input
          value={step.defCode}
          onChange={(e) => onChange({ ...step, defCode: e.target.value })}
          placeholder="如：leave_flow"
          className="font-mono"
        />
      </div>
      <label className="flex items-center justify-between rounded-md border p-2.5">
        <span>
          <span className="block text-sm font-medium">异步执行</span>
          <span className="block text-xs text-muted-foreground">
            开启后主流程并行旁路不阻塞，子流程结束信号回写；关闭为同步（CallActivity 阻塞）
          </span>
        </span>
        <Switch checked={step.async} onCheckedChange={(async) => onChange({ ...step, async })} />
      </label>
      <div className="space-y-2">
        <Label className="text-xs">参数映射（子流程变量 ← 父流程字段）</Label>
        {step.paramMap.length === 0 && (
          <p className="rounded-md border border-dashed py-3 text-center text-xs text-muted-foreground">
            未配置映射，子流程将不接收父流程数据
          </p>
        )}
        {step.paramMap.map((m, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <Input
              value={m.child}
              onChange={(e) => updateMap(index, { ...m, child: e.target.value })}
              placeholder="子变量名"
              className="h-8 flex-1 font-mono text-xs"
            />
            <span className="shrink-0 text-xs text-muted-foreground">←</span>
            <Select value={m.parent || undefined} onValueChange={(v) => updateMap(index, { ...m, parent: v })}>
              <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
                <SelectValue placeholder={fields.length ? "父字段" : "无字段"} />
              </SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-500"
              onClick={() => removeMap(index)}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={addMap}>
          <Plus className="size-3" /> 添加映射
        </Button>
      </div>
    </div>
  )
}

/** 定时：相对时长 / 绝对日期时间 */
function TimerEditor({ step, onChange }: { step: TimerStep; onChange: (step: TimerStep) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">定时方式</Label>
        <RadioGroup
          value={step.mode}
          onValueChange={(v) => onChange({ ...step, mode: v as TimerStep["mode"] })}
          className="flex gap-3"
        >
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <RadioGroupItem value="duration" /> 相对时长
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <RadioGroupItem value="date" /> 绝对日期
          </label>
        </RadioGroup>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{step.mode === "duration" ? "等待时长（ISO8601）" : "触发日期时间"}</Label>
        {step.mode === "duration" ? (
          <Input
            value={step.value}
            onChange={(e) => onChange({ ...step, value: e.target.value })}
            placeholder="如 PT1H（1 小时）/ P1D（1 天）"
            className="font-mono"
          />
        ) : (
          <Input
            type="datetime-local"
            value={step.value}
            onChange={(e) => onChange({ ...step, value: e.target.value })}
          />
        )}
        <p className="text-xs text-muted-foreground">
          到点后由 AsyncExecutor 驱动进入下一步（intermediateCatchEvent·timer）
        </p>
      </div>
    </div>
  )
}

/** 触发：立即/定时 + 处理器 bean 或 Webhook */
function TriggerEditor({ step, onChange }: { step: TriggerStep; onChange: (step: TriggerStep) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">触发时机</Label>
        <RadioGroup
          value={step.triggerType}
          onValueChange={(v) => onChange({ ...step, triggerType: v as TriggerStep["triggerType"] })}
          className="flex gap-3"
        >
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <RadioGroupItem value="IMMEDIATE" /> 立即
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <RadioGroupItem value="TIMER" /> 定时
          </label>
        </RadioGroup>
      </div>
      {step.triggerType === "TIMER" && (
        <div className="space-y-1.5">
          <Label className="text-xs">定时表达式（ISO8601 时长 / 日期）</Label>
          <Input
            value={step.timer ?? ""}
            onChange={(e) => onChange({ ...step, timer: e.target.value })}
            placeholder="如 PT30M"
            className="font-mono"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs">处理器 Bean（已注册触发器）</Label>
        <Input
          value={step.handler ?? ""}
          onChange={(e) => onChange({ ...step, handler: e.target.value })}
          placeholder="如 syncErpTrigger"
          className="font-mono"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">或 Webhook 地址</Label>
        <Input
          value={step.webhookUrl ?? ""}
          onChange={(e) => onChange({ ...step, webhookUrl: e.target.value })}
          placeholder="https://…（与处理器二选一）"
        />
        <p className="text-xs text-muted-foreground">后端 TriggerDelegate 执行业务逻辑后进入下一步</p>
      </div>
    </div>
  )
}

/** AI 审批：模型 / 系统提示词 / 表单上下文 / 输出映射 */
function AiEditor({
  step,
  onChange,
  fields,
}: {
  step: AiStep
  onChange: (step: AiStep) => void
  fields: FormFieldOption[]
}) {
  const toggleField = (key: string, checked: boolean) =>
    onChange({
      ...step,
      formContext: checked ? [...step.formContext, key] : step.formContext.filter((k) => k !== key),
    })

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">模型</Label>
        <Input
          value={step.model}
          onChange={(e) => onChange({ ...step, model: e.target.value })}
          placeholder="如 gpt-4o-mini / claude-3-5-sonnet（留空则后端按 oa.ai.* 默认，无 key 降级模拟）"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">系统提示词</Label>
        <Textarea
          value={step.systemPrompt}
          onChange={(e) => onChange({ ...step, systemPrompt: e.target.value })}
          placeholder="描述 AI 审批的判定规则，例如：金额≤1000 元且事由充分则同意，否则驳回并说明理由。"
          rows={4}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">注入表单上下文</Label>
        {fields.length === 0 ? (
          <p className="rounded-md border border-dashed py-3 text-center text-xs text-muted-foreground">
            未绑定表单，无可注入字段
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {fields.map((f) => (
              <label
                key={f.key}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors hover:bg-accent"
              >
                <Checkbox
                  checked={step.formContext.includes(f.key)}
                  onCheckedChange={(c) => toggleField(f.key, c === true)}
                />
                <span className="truncate">{f.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label className="text-xs">输出映射（AI 结果写入流程变量）</Label>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
          <Label className="text-xs text-muted-foreground">决策变量</Label>
          <Input
            value={step.outputMap.decision}
            onChange={(e) => onChange({ ...step, outputMap: { ...step.outputMap, decision: e.target.value } })}
            placeholder="approve|reject|route 写入此变量"
            className="h-8 font-mono text-xs"
          />
          <Label className="text-xs text-muted-foreground">意见变量</Label>
          <Input
            value={step.outputMap.comment}
            onChange={(e) => onChange({ ...step, outputMap: { ...step.outputMap, comment: e.target.value } })}
            placeholder="AI 审批意见写入此变量"
            className="h-8 font-mono text-xs"
          />
          <Label className="text-xs text-muted-foreground">路由变量</Label>
          <Input
            value={step.outputMap.route ?? ""}
            onChange={(e) => onChange({ ...step, outputMap: { ...step.outputMap, route: e.target.value } })}
            placeholder="决策=route 时的目标节点（可选）"
            className="h-8 font-mono text-xs"
          />
        </div>
        <p className="text-xs text-muted-foreground">审批记录标注 actor=AI；无 key 时意见明示「AI模拟」</p>
      </div>
    </div>
  )
}

const ADVANCED_META: Record<string, { title: string; icon: typeof Workflow; iconClass: string }> = {
  subprocess: { title: "子流程配置", icon: Workflow, iconClass: "text-indigo-500" },
  timer: { title: "定时配置", icon: Timer, iconClass: "text-amber-500" },
  trigger: { title: "触发器配置", icon: Zap, iconClass: "text-fuchsia-500" },
  ai: { title: "AI 审批配置", icon: Bot, iconClass: "text-violet-500" },
  autoApprove: { title: "自动通过配置", icon: CircleCheck, iconClass: "text-teal-500" },
  autoReject: { title: "自动拒绝配置", icon: CircleX, iconClass: "text-rose-500" },
}

type AdvancedStep = SubprocessStep | TimerStep | TriggerStep | AiStep | AutoApproveStep | AutoRejectStep

/** 高级节点内联属性面板（子流程/定时/触发/AI/自动通过/自动拒绝） */
function AdvancedNodePanel({
  step,
  onNameChange,
  onStepChange,
  fields,
}: {
  step: AdvancedStep
  onNameChange: (name: string) => void
  onStepChange: (step: StepNode) => void
  fields: FormFieldOption[]
}) {
  const meta = ADVANCED_META[step.kind]
  const Icon = meta.icon
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3.5 py-3 text-sm font-semibold">
        <Icon className={`size-4 ${meta.iconClass}`} />
        {meta.title}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">节点名称</Label>
          <Input value={step.name} onChange={(e) => onNameChange(e.target.value)} className="h-8" />
        </div>
        {step.kind === "subprocess" && (
          <SubprocessEditor step={step} onChange={(s) => onStepChange(s)} fields={fields} />
        )}
        {step.kind === "timer" && <TimerEditor step={step} onChange={(s) => onStepChange(s)} />}
        {step.kind === "trigger" && <TriggerEditor step={step} onChange={(s) => onStepChange(s)} />}
        {step.kind === "ai" && <AiEditor step={step} onChange={(s) => onStepChange(s)} fields={fields} />}
        {step.kind === "autoApprove" && (
          <p className="rounded-md border border-teal-500/30 bg-teal-500/5 p-3 text-xs text-muted-foreground">
            系统节点：流程到达该节点无需人工审批，自动通过并进入下一步（审批记录标注 action=AUTO_APPROVE）。
            常用于满足条件后免审直通。
          </p>
        )}
        {step.kind === "autoReject" && (
          <p className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-muted-foreground">
            系统节点：流程到达该节点即自动拒绝（驳回）。常配合条件分支实现「不满足条件自动驳回」。
          </p>
        )}
      </div>
    </div>
  )
}

/* ---------- 主设计器 ---------- */

type Selection = { kind: "process" } | { kind: "step"; id: string } | { kind: "branch"; id: string }

export interface DingtalkProcessDesignerProps {
  steps: StepNode[]
  onStepsChange: Dispatch<SetStateAction<StepNode[]>>
  nodeProps: NodePropsMap
  onNodePropsChange: Dispatch<SetStateAction<NodePropsMap>>
  /** 绑定表单的字段，供条件/表单字段规则选择；未绑定表单时为空 */
  formFields: FormFieldOption[]
  /** 流程级基础信息（映射 ProcessDef name/remark/icon/category） */
  base: ProcessBase
  onBaseChange: (base: ProcessBase) => void
  /** 流程级配置（序列化进 designerJson.flowConfig） */
  flowConfig: FlowConfig
  onFlowConfigChange: (config: FlowConfig) => void
}

export function DingtalkProcessDesigner({
  steps,
  onStepsChange: setSteps,
  nodeProps,
  onNodePropsChange: setNodeProps,
  formFields,
  base,
  onBaseChange,
  flowConfig,
  onFlowConfigChange,
}: DingtalkProcessDesignerProps) {
  const [selection, setSelection] = useState<Selection>({ kind: "process" })

  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const nodePropsRef = useRef(nodeProps)
  nodePropsRef.current = nodeProps

  /** 删除节点后清理 nodeProps 中的孤儿配置 */
  const pruneNodeProps = useCallback(
    (nextSteps: StepNode[]) => {
      const alive = collectNodeIds(nextSteps)
      setNodeProps((prev) => {
        const next: NodePropsMap = {}
        for (const [id, props] of Object.entries(prev)) if (alive.has(id)) next[id] = props
        return next
      })
    },
    [setNodeProps],
  )

  const actions = useMemo<FlowActions>(
    () => ({
      insert: (listId, index, kind) => {
        const step = createStep(kind)
        setSteps((prev) => updateList(prev, listId, (list) => [...list.slice(0, index), step, ...list.slice(index)]))
      },
      openStepConfig: (stepId) => {
        const step = findStep(stepsRef.current, stepId)
        if (!step || isBranchContainer(step)) return
        setSelection({ kind: "step", id: stepId })
      },
      openBranchConfig: (branchId) => {
        setSelection({ kind: "branch", id: branchId })
      },
      deleteStep: (stepId) => {
        const next = removeStep(stepsRef.current, stepId)
        setSteps(next)
        pruneNodeProps(next)
        setSelection((sel) => (sel.kind === "step" && sel.id === stepId ? { kind: "process" } : sel))
      },
      deleteBranch: (conditionId, branchId) => {
        const next = removeBranch(stepsRef.current, conditionId, branchId)
        setSteps(next)
        pruneNodeProps(next)
        setSelection((sel) => (sel.kind === "branch" && sel.id === branchId ? { kind: "process" } : sel))
      },
      addBranchTo: (conditionId) => {
        setSteps((prev) => addBranch(prev, conditionId))
      },
    }),
    [setSteps, pruneNodeProps],
  )

  const renderStepSummary = (step: LeafStep): ReactNode => {
    const props = nodeProps[step.id]
    if (step.kind === "approval") {
      const text = ruleSummaryText(props?.assigneeRules, formFields)
      const mode = props?.multiMode
      return text ? (
        <span className="truncate text-sm">
          {text}
          {mode && <span className="ml-1 text-xs text-muted-foreground">({MULTI_MODE_META[mode].label})</span>}
        </span>
      ) : (
        <span className="text-sm text-orange-500">请设置审批人规则</span>
      )
    }
    if (step.kind === "cc") {
      const cc = props?.ccUsers ?? []
      return cc.length ? (
        <span className="truncate text-sm">{cc.map((r) => r.name).join("、")}</span>
      ) : (
        <span className="text-sm text-sky-600">请设置抄送人</span>
      )
    }
    if (step.kind === "autoApprove") return <span className="text-sm text-teal-600">到达自动通过</span>
    if (step.kind === "autoReject") return <span className="text-sm text-rose-600">到达自动拒绝</span>
    const text = leafSummaryText(step)
    const hint: Record<string, string> = {
      subprocess: "请选择子流程",
      timer: "请设置等待时间",
      trigger: "请设置触发器",
      ai: "请配置 AI 审批",
    }
    return text ? (
      <span className="truncate text-sm">{text}</span>
    ) : (
      <span className="text-sm text-muted-foreground">{hint[step.kind]}</span>
    )
  }

  const renderBranchSummary = (branch: Branch, isDefault: boolean, containerKind?: ContainerKind): ReactNode => {
    if (containerKind === "parallel") return <span className="text-sm text-sky-600">并行执行（无条件）</span>
    if (isDefault) return <span className="text-sm text-emerald-600">其他情况进入此分支</span>
    const text = conditionSummaryText(nodeProps[branch.id]?.condition, formFields)
    return text ? (
      <span className="truncate text-sm">{text}</span>
    ) : (
      <span className="text-sm text-emerald-600">请设置条件</span>
    )
  }

  /* ---- 属性回写 ---- */
  const setStepName = (stepId: string, name: string) =>
    setSteps((prev) => updateStep(prev, stepId, (s) => ({ ...s, name })))
  const setAdvancedStep = (stepId: string, next: StepNode) =>
    setSteps((prev) => updateStep(prev, stepId, () => next))
  const setBranchName = (branchId: string, name: string) =>
    setSteps((prev) => updateBranch(prev, branchId, (b) => ({ ...b, name })))
  const setNodePropsFor = (id: string, next: WfNodeProps) =>
    setNodeProps((prev) => ({ ...prev, [id]: next }))

  /* ---- 右侧面板内容 ---- */
  const panel = ((): ReactNode => {
    if (selection.kind === "process") {
      return (
        <PropertyPanel
          target="process"
          config={{ base, flow: flowConfig }}
          onChange={(next: ProcessConfig) => {
            onBaseChange(next.base)
            onFlowConfigChange(next.flow)
          }}
          formFields={formFields}
        />
      )
    }

    if (selection.kind === "step") {
      const step = findStep(steps, selection.id)
      if (!step || isBranchContainer(step)) return processHint()
      if (step.kind === "approval" || step.kind === "cc") {
        return (
          <PropertyPanel
            target={{ nodeId: step.id, nodeType: step.kind }}
            config={nodeProps[step.id] ?? {}}
            onChange={(next: WfNodeProps) => setNodePropsFor(step.id, next)}
            formFields={formFields}
            nodeName={step.name}
            onNodeNameChange={(name) => setStepName(step.id, name)}
          />
        )
      }
      return (
        <AdvancedNodePanel
          step={step}
          onNameChange={(name) => setStepName(step.id, name)}
          onStepChange={(next) => setAdvancedStep(step.id, next)}
          fields={formFields}
        />
      )
    }

    // branch（条件/包容/并行 的某条分支）
    const found = findBranch(steps, selection.id)
    if (!found) return processHint()
    const containerKind = found.condition.kind
    // 并行分支：无条件，只配名称
    if (containerKind === "parallel") {
      return <ParallelBranchPanel name={found.branch.name} onNameChange={(name) => setBranchName(found.branch.id, name)} />
    }
    const isDefault = found.index === found.condition.branches.length - 1
    return (
      <PropertyPanel
        target={{ nodeId: found.branch.id, nodeType: "condition" }}
        config={nodeProps[found.branch.id] ?? { condition: { logic: "AND", items: [], isDefault } }}
        onChange={(next: WfNodeProps) => setNodePropsFor(found.branch.id, next)}
        formFields={formFields}
        nodeName={found.branch.name}
        onNodeNameChange={(name) => setBranchName(found.branch.id, name)}
        branchMeta={{ isDefault, priority: found.index + 1 }}
      />
    )
  })()

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <ApprovalFlowCanvas
          steps={steps}
          actions={actions}
          renderStepSummary={renderStepSummary}
          renderBranchSummary={renderBranchSummary}
          onPaneClick={() => setSelection({ kind: "process" })}
        />
      </div>
      <aside className="w-[360px] shrink-0 border-l">{panel}</aside>
    </div>
  )
}

/** 并行分支属性面板（无条件，仅名称） */
function ParallelBranchPanel({ name, onNameChange }: { name: string; onNameChange: (name: string) => void }): ReactNode {
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3.5 py-3 text-sm font-semibold">
        <Workflow className="size-4 text-sky-500" />
        并行分支
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">分支名称</Label>
          <Input value={name} onChange={(e) => onNameChange(e.target.value)} className="h-8" />
        </div>
        <p className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-muted-foreground">
          并行分支无需条件：流程到达并行网关时全部分支同时执行，所有分支汇聚后继续。
          用顶部「+」可增删分支。
        </p>
      </div>
    </div>
  )
}

function processHint(): ReactNode {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
      节点已删除，点击画布空白查看流程属性
    </div>
  )
}
