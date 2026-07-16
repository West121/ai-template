/**
 * 共享属性面板（仿钉钉 / BPMN 共用）：右侧固定，`基础属性 / 高级属性` 双 Tab + Collapsible 分区。
 *
 * props: { target: "process" | { nodeId, nodeType }, config, onChange, formFields, ... }
 *  - target="process"：流程级面板（基础信息 + 流程操作开关 + 流程启动 / 高级：安全·其他设置）
 *  - target=node：节点级面板（基础信息 + 按 nodeType 分区）
 *      approval：审批人规则 + 多人模式 + 空值策略 + 按钮操作白名单（allowedOps）/ 高级：办理选项
 *      cc：抄送选人
 *      condition：结构化条件（含默认分支）
 *
 * 两个设计器把各自选中态映射成统一 config 传入，onChange 回写各自模型。
 * 详见 docs/flow-designer-v2.md「共享属性面板组件」节。
 */
import { useState, type ReactNode } from "react"
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  Clock,
  GitFork,
  ListChecks,
  MessageSquare,
  Plus,
  Rocket,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  Variable,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useHasPerm } from "@/stores/auth-store"
import { OrgPicker, OrgPickerField, type OrgRef } from "@/components/org-picker"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { CodeEditor } from "@/components/code-editor"
import {
  EMPTY_STRATEGY_META,
  FORM_PERM_META,
  MULTI_MODE_META,
  OPERATOR_META,
  TIMEOUT_ACTION_META,
  type AllowedOp,
  type AssigneeKind,
  type AssigneeRule,
  type AssigneeSource,
  type AuditMenu,
  type BranchCondition,
  type ConditionItem,
  type ConditionOperator,
  type EmptyStrategy,
  type EventAction,
  type EventActionConfig,
  type EventApiConfig,
  type FormPerm,
  type HandleOptions,
  type MultiMode,
  type NodeEvent,
  type NodeTimeout,
  type TimeoutAction,
  type VoteConfig,
  type VoteWeight,
  type WfNodeProps,
} from "../types"
import {
  ALLOWED_OP_META,
  ASSIGNEE_FIXED_REF_TYPES,
  ASSIGNEE_KIND_META,
  ASSIGNEE_SOURCE_MATRIX,
  ASSIGNEE_SOURCE_META,
  BLOCKING_NODE_TRIGGERS,
  BLOCKING_PROCESS_TRIGGERS,
  DEFAULT_ALLOWED_OPS,
  EVENT_ACTION_META,
  EVENT_TRIGGER_META,
  FLOW_VAR_TYPE_META,
  HANDLE_OPTION_SWITCHES,
  PROCESS_EVENT_TRIGGER_META,
  defaultHandleOptions,
  defaultVoteConfig,
  type FlowConfig,
  type FlowVarType,
  type FlowVariable,
  type FormFieldOption,
  type ProcessConfig,
  type ProcessEvent,
} from "./config"
import { FormulaField } from "./formula-editor"
import { ScriptEditor } from "@/components/script-editor"

/* ==================== 通用小组件 ==================== */

/** 可折叠分区 */
function Section({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: {
  title: string
  icon: typeof Users
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3.5 py-2.5 text-left">
        <Icon className="size-3.5 text-primary" />
        <span className="flex-1 text-xs font-medium">{title}</span>
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3.5 pb-3.5 pt-0.5">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** 开关行 */
function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <Label className="text-xs text-muted-foreground">{children}</Label>
}

/* ==================== 审批人规则编辑器（两维模型：类型宫格 + 上下文来源 + 配置区） ==================== */

const isQuickKind = (k: AssigneeKind) => k === "LEADER" || k === "INITIATOR"

export function AssigneeRulesEditor({
  rules,
  onChange,
  fields,
  nodeOptions,
  variableOptions,
}: {
  rules: AssigneeRule[]
  onChange: (rules: AssigneeRule[]) => void
  fields: FormFieldOption[]
  /** 本流程其它节点（供"指定节点办理人"选择），由 property-panel 上层传入 [{id,name}] */
  nodeOptions: { id: string; name: string }[]
  /** 已声明流程变量名（供"来自变量"选择） */
  variableOptions: string[]
}) {
  const [orgPickerIndex, setOrgPickerIndex] = useState<number | null>(null)
  const userFields = fields.filter((f) => f.isUser)

  const addRule = () => onChange([...rules, { kind: "ACCOUNT", source: "FIXED", refs: [] }])
  const updateRule = (i: number, r: AssigneeRule) => onChange(rules.map((x, k) => (k === i ? r : x)))
  const removeRule = (i: number) => onChange(rules.filter((_, k) => k !== i))

  const changeKind = (i: number, kind: AssigneeKind) => {
    if (kind === "LEADER") return updateRule(i, { kind, level: 1 })
    if (kind === "INITIATOR") return updateRule(i, { kind })
    const source = ASSIGNEE_SOURCE_MATRIX[kind][0] // 默认第一个合法来源
    // FIXED：岗位用 postName，其余（账户/角色/部门）用 OrgPicker refs
    const seed = source === "FIXED" ? (kind === "POST" ? { postName: "" } : { refs: [] }) : {}
    updateRule(i, { kind, source, ...seed })
  }

  const changeSource = (i: number, rule: AssigneeRule, source: AssigneeSource) => {
    const next: AssigneeRule = { kind: rule.kind, source }
    if (source === "FIXED") next.refs = []
    if (source === "FORM_FIELD") next.field = userFields[0]?.key ?? ""
    if (source === "VARIABLE") next.varName = variableOptions[0] ?? ""
    if (source === "FORMULA") next.formula = ""
    if (source === "APPLICANT") next.applicantValue = "DEPT"
    if (source === "NODE_HANDLER") next.fromNodeId = nodeOptions[0]?.id ?? ""
    updateRule(i, next)
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground">多条规则取并集去重：最终办理人 = 各规则解析结果之和。</p>
      {rules.length === 0 && (
        <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
          尚未配置办理人规则，请从下方添加
        </p>
      )}

      {rules.map((rule, index) => (
        <div key={index} className="space-y-2 rounded-md border p-2.5">
          {/* 删除 */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">规则 {index + 1}</span>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-rose-500"
              onClick={() => removeRule(index)}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          {/* 类型宫格（2 列单选） */}
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(ASSIGNEE_KIND_META) as AssigneeKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => changeKind(index, k)}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs transition-colors",
                  rule.kind === k
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted",
                )}
              >
                {ASSIGNEE_KIND_META[k].label}
              </button>
            ))}
          </div>

          {/* 来源下拉（快捷类型不显示）；rule.kind 缺省/非法时兜底空数组，避免面板崩溃 */}
          {!isQuickKind(rule.kind) && (ASSIGNEE_SOURCE_MATRIX[rule.kind]?.length ?? 0) > 1 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">来源</span>
              <Select
                value={rule.source ?? ASSIGNEE_SOURCE_MATRIX[rule.kind]?.[0]}
                onValueChange={(v) => changeSource(index, rule, v as AssigneeSource)}
              >
                <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(ASSIGNEE_SOURCE_MATRIX[rule.kind] ?? []).map((s) => (
                    <SelectItem key={s} value={s}>
                      {ASSIGNEE_SOURCE_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 来源专属配置区 */}
          {renderSourceConfig(index, rule, {
            userFields,
            nodeOptions,
            variableOptions,
            fields,
            orgPickerIndex,
            setOrgPickerIndex,
            updateRule,
          })}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={addRule}>
        <Plus className="size-3" />
        添加办理人规则
      </Button>
    </div>
  )
}

function renderSourceConfig(
  index: number,
  rule: AssigneeRule,
  ctx: {
    userFields: FormFieldOption[]
    nodeOptions: { id: string; name: string }[]
    variableOptions: string[]
    fields: FormFieldOption[]
    orgPickerIndex: number | null
    setOrgPickerIndex: (i: number | null) => void
    updateRule: (i: number, r: AssigneeRule) => void
  },
) {
  const { userFields, nodeOptions, variableOptions, fields, orgPickerIndex, setOrgPickerIndex, updateRule } = ctx

  // 快捷：发起人主管
  if (rule.kind === "LEADER") {
    return (
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">第</Label>
        <Input
          type="number"
          min={1}
          max={10}
          value={rule.level ?? 1}
          onChange={(e) => updateRule(index, { ...rule, level: Math.max(1, Number(e.target.value) || 1) })}
          className="h-8 w-20 text-sm"
        />
        <Label className="text-xs text-muted-foreground">级主管（逐级向上）</Label>
      </div>
    )
  }
  if (rule.kind === "INITIATOR") {
    return <p className="text-xs text-muted-foreground">办理人为流程发起人本人。</p>
  }

  const source = rule.source ?? "FIXED"

  // 岗位固定 → 文本
  if (source === "FIXED" && rule.kind === "POST") {
    return (
      <Input
        value={rule.postName ?? ""}
        onChange={(e) => updateRule(index, { ...rule, postName: e.target.value })}
        placeholder="岗位名称（逗号分隔多个）"
        className="h-8 text-sm"
      />
    )
  }
  // 账户/角色/部门固定 → OrgPicker（按类型限定范围）
  if (source === "FIXED") {
    const types = ASSIGNEE_FIXED_REF_TYPES[rule.kind] ?? []
    const kindLabel = ASSIGNEE_KIND_META[rule.kind]?.label ?? "办理人"
    return (
      <>
        <OrgPickerField
          value={rule.refs ?? []}
          multiple
          placeholder={`选择${kindLabel}`}
          onOpen={() => setOrgPickerIndex(index)}
          onRemove={(ref) =>
            updateRule(index, {
              ...rule,
              refs: (rule.refs ?? []).filter((r) => !(r.type === ref.type && r.id === ref.id)),
            })
          }
        />
        <OrgPicker
          open={orgPickerIndex === index}
          onOpenChange={(open) => !open && setOrgPickerIndex(null)}
          title={`选择${kindLabel}`}
          types={types}
          value={rule.refs ?? []}
          onConfirm={(refs) => updateRule(index, { ...rule, refs })}
        />
      </>
    )
  }
  if (source === "FORM_FIELD") {
    return (
      <Select value={rule.field || undefined} onValueChange={(v) => updateRule(index, { ...rule, field: v })}>
        <SelectTrigger size="sm" className="h-8 w-full text-sm">
          <SelectValue placeholder={userFields.length ? "选择选人字段" : "表单无选人字段"} />
        </SelectTrigger>
        <SelectContent>
          {userFields.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (source === "VARIABLE") {
    return (
      <Select value={rule.varName || undefined} onValueChange={(v) => updateRule(index, { ...rule, varName: v })}>
        <SelectTrigger size="sm" className="h-8 w-full text-sm">
          <SelectValue placeholder={variableOptions.length ? "选择流程变量" : "未声明流程变量"} />
        </SelectTrigger>
        <SelectContent>
          {variableOptions.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (source === "FORMULA") {
    return (
      <FormulaField
        value={rule.formula ?? ""}
        onChange={(formula) => updateRule(index, { ...rule, formula })}
        fields={fields}
      />
    )
  }
  if (source === "APPLICANT") {
    return <p className="text-xs text-muted-foreground">办理人为申请人所在部门（全体成员）。</p>
  }
  // PREV_HANDLER / NODE_HANDLER
  return (
    <div className="space-y-2">
      {source === "NODE_HANDLER" && (
        <Select value={rule.fromNodeId || undefined} onValueChange={(v) => updateRule(index, { ...rule, fromNodeId: v })}>
          <SelectTrigger size="sm" className="h-8 w-full text-sm">
            <SelectValue placeholder="选择目标节点" />
          </SelectTrigger>
          <SelectContent>
            {nodeOptions.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={rule.takeLeader ?? false}
          onCheckedChange={(v) => updateRule(index, { ...rule, takeLeader: v })}
        />
        取其直属主管
      </label>
    </div>
  )
}

/* ==================== 结构化条件编辑器（共享） ==================== */

export function ConditionEditor({
  condition,
  onChange,
  fields,
}: {
  condition: BranchCondition
  onChange: (condition: BranchCondition) => void
  fields: FormFieldOption[]
}) {
  if (condition.isDefault) {
    return (
      <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
        默认分支：其他条件都不满足时进入，无需配置条件
      </p>
    )
  }

  const addItem = () => {
    const item: ConditionItem = { field: fields[0]?.key ?? "", operator: "eq", value: "" }
    onChange({ ...condition, items: [...condition.items, item] })
  }
  const updateItem = (index: number, item: ConditionItem) =>
    onChange({ ...condition, items: condition.items.map((it, i) => (i === index ? item : it)) })
  const removeItem = (index: number) =>
    onChange({ ...condition, items: condition.items.filter((_, i) => i !== index) })

  return (
    <div className="space-y-2.5">
      {condition.items.length > 1 && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">条件间关系</Label>
          <RadioGroup
            value={condition.logic}
            onValueChange={(v) => onChange({ ...condition, logic: v as "AND" | "OR" })}
            className="flex gap-3"
          >
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <RadioGroupItem value="AND" /> 且（全部满足）
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <RadioGroupItem value="OR" /> 或（任一满足）
            </label>
          </RadioGroup>
        </div>
      )}

      {condition.items.length === 0 && (
        <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
          尚未添加条件，添加后按字段值判定是否进入本分支
        </p>
      )}

      {condition.items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Select
            value={item.field || undefined}
            onValueChange={(v) => updateItem(index, { ...item, field: v })}
          >
            <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
              <SelectValue placeholder={fields.length ? "字段" : "表单无字段"} />
            </SelectTrigger>
            <SelectContent>
              {fields.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={item.operator}
            onValueChange={(v) => updateItem(index, { ...item, operator: v as ConditionOperator })}
          >
            <SelectTrigger size="sm" className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(OPERATOR_META) as ConditionOperator[]).map((op) => (
                <SelectItem key={op} value={op}>
                  {OPERATOR_META[op]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={item.value}
            onChange={(e) => updateItem(index, { ...item, value: e.target.value })}
            placeholder="值"
            className="h-8 w-24 text-xs"
          />
          <button
            type="button"
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-500"
            onClick={() => removeItem(index)}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={addItem}>
        <Plus className="size-3" />
        添加条件
      </Button>
    </div>
  )
}

/* ==================== 抄送人字段（共享） ==================== */

function CcUsersField({ value, onChange }: { value: OrgRef[]; onChange: (refs: OrgRef[]) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <OrgPickerField
        value={value}
        multiple
        placeholder="选择抄送成员 / 部门 / 角色"
        onOpen={() => setOpen(true)}
        onRemove={(ref) => onChange(value.filter((r) => !(r.type === ref.type && r.id === ref.id)))}
      />
      <OrgPicker open={open} onOpenChange={setOpen} title="选择抄送人" value={value} onConfirm={onChange} />
    </>
  )
}

/* ==================== 启动权限字段 ==================== */

function ScopeField({ value, onChange }: { value: OrgRef[]; onChange: (refs: OrgRef[]) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <OrgPickerField
        value={value}
        multiple
        placeholder="不限（全体成员可发起）"
        onOpen={() => setOpen(true)}
        onRemove={(ref) => onChange(value.filter((r) => !(r.type === ref.type && r.id === ref.id)))}
      />
      <OrgPicker open={open} onOpenChange={setOpen} title="选择可发起人" value={value} onConfirm={onChange} />
    </>
  )
}

/* ==================== 面板 props ==================== */

export interface NodeTarget {
  nodeId: string
  nodeType: string
}

export type PropertyPanelProps =
  | {
      target: "process"
      config: ProcessConfig
      onChange: (next: ProcessConfig) => void
      formFields: FormFieldOption[]
    }
  | {
      target: NodeTarget
      config: WfNodeProps
      onChange: (next: WfNodeProps) => void
      formFields: FormFieldOption[]
      /** 节点名称（存 StepNode，非 nodeProps） */
      nodeName?: string
      onNodeNameChange?: (name: string) => void
      /** 条件分支元信息（nodeType=condition 时） */
      branchMeta?: { isDefault: boolean; priority: number }
      /** 本流程其它节点（供审批人规则"指定节点办理人"选择），排除当前节点自身 */
      nodeOptions?: { id: string; name: string }[]
      /** 流程级配置（供审批人规则"来自变量"选择流程变量） */
      flowConfig?: FlowConfig
    }

/* ==================== 面板主体 ==================== */

export function PropertyPanel(props: PropertyPanelProps) {
  const [tab, setTab] = useState<"basic" | "advanced">("basic")

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="shrink-0 border-b px-3.5 pt-3">
        <div className="pb-2 text-sm font-semibold">
          {props.target === "process" ? "流程属性" : nodeTitle(props.target.nodeType, props.branchMeta)}
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full">
            <TabsTrigger value="basic" className="flex-1 text-xs">
              基础属性
            </TabsTrigger>
            <TabsTrigger value="advanced" className="flex-1 text-xs">
              高级属性
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.target === "process" ? (
          <ProcessPanelBody tab={tab} config={props.config} onChange={props.onChange} />
        ) : (
          <NodePanelBody tab={tab} {...props} />
        )}
      </div>
    </div>
  )
}

function nodeTitle(nodeType: string, branchMeta?: { isDefault: boolean; priority: number }): string {
  switch (nodeType) {
    case "approval":
      return "审批节点属性"
    case "cc":
      return "抄送节点属性"
    case "condition":
      return branchMeta?.isDefault ? "默认分支属性" : "条件分支属性"
    default:
      return "节点属性"
  }
}

/* ---------- 流程级面板 ---------- */

function ProcessPanelBody({
  tab,
  config,
  onChange,
}: {
  tab: "basic" | "advanced"
  config: ProcessConfig
  onChange: (next: ProcessConfig) => void
}) {
  const { base, flow } = config
  const setBase = (patch: Partial<ProcessConfig["base"]>) => onChange({ ...config, base: { ...base, ...patch } })
  const setOps = (patch: Partial<ProcessConfig["flow"]["operations"]>) =>
    onChange({ ...config, flow: { ...flow, operations: { ...flow.operations, ...patch } } })
  const setStart = (patch: Partial<ProcessConfig["flow"]["start"]>) =>
    onChange({ ...config, flow: { ...flow, start: { ...flow.start, ...patch } } })
  const setFlow = (patch: Partial<ProcessConfig["flow"]>) =>
    onChange({ ...config, flow: { ...flow, ...patch } })

  if (tab === "basic") {
    return (
      <>
        <Section title="基础信息" icon={Settings2}>
          <div className="space-y-1.5">
            <FieldLabel>流程名称</FieldLabel>
            <Input
              value={base.name}
              onChange={(e) => setBase({ name: e.target.value })}
              placeholder="请输入流程名称"
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>说明</FieldLabel>
            <Textarea
              value={base.description}
              onChange={(e) => setBase({ description: e.target.value })}
              placeholder="流程用途说明"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <FieldLabel>图标（emoji / 名称）</FieldLabel>
              <Input
                value={base.icon}
                onChange={(e) => setBase({ icon: e.target.value })}
                placeholder="如 📝"
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>分类</FieldLabel>
              <Input
                value={base.category}
                onChange={(e) => setBase({ category: e.target.value })}
                placeholder="如 人事"
                className="h-8"
              />
            </div>
          </div>
        </Section>

        <Section title="流程操作" icon={SlidersHorizontal}>
          <SwitchRow
            label="允许作废"
            description="发起人可作废流程实例"
            checked={flow.operations.terminate}
            onCheckedChange={(v) => setOps({ terminate: v })}
          />
          <SwitchRow
            label="允许收回"
            description="下一节点未办理时可收回"
            checked={flow.operations.retrieve}
            onCheckedChange={(v) => setOps({ retrieve: v })}
          />
          <SwitchRow
            label="允许催办"
            description="发起人可催办当前办理人"
            checked={flow.operations.urge}
            onCheckedChange={(v) => setOps({ urge: v })}
          />
          <SwitchRow
            label="允许撤销"
            description="发起人可撤销流程"
            checked={flow.operations.cancel}
            onCheckedChange={(v) => setOps({ cancel: v })}
          />
        </Section>

        <Section title="流程启动" icon={Rocket}>
          <div className="space-y-1.5">
            <FieldLabel>启动权限</FieldLabel>
            <ScopeField value={flow.start.scope} onChange={(scope) => setStart({ scope })} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>任务标题</FieldLabel>
            <Input
              value={flow.start.taskTitle}
              onChange={(e) => setStart({ taskTitle: e.target.value })}
              placeholder="留空用默认标题；支持表单字段变量"
              className="h-8"
            />
          </div>
        </Section>
      </>
    )
  }

  // 高级 tab：任务标题 fx + 流程变量
  return (
    <>
      <Section title="任务标题（fx）" icon={Variable}>
        <p className="text-xs text-muted-foreground">
          支持表单字段插值，如 <code className="rounded bg-muted px-1">{"{申请人}的请假 ${days} 天"}</code>。
        </p>
        <Input
          value={flow.start.taskTitle}
          onChange={(e) => onChange({ ...config, flow: { ...flow, start: { ...flow.start, taskTitle: e.target.value } } })}
          placeholder="留空使用默认标题"
          className="h-8"
        />
      </Section>

      <Section title="流程变量" icon={Variable} defaultOpen={false}>
        <FlowVariablesEditor value={flow.variables} onChange={(variables) => setFlow({ variables })} />
      </Section>

      <ProcessEventsSection value={flow.events ?? []} onChange={(events) => setFlow({ events })} />
    </>
  )
}

/* ---------- 节点级面板 ---------- */

function NodePanelBody(
  props: Extract<PropertyPanelProps, { target: NodeTarget }> & { tab: "basic" | "advanced" },
) {
  const { tab, target, config, onChange, formFields, nodeName, onNodeNameChange, branchMeta, nodeOptions, flowConfig } =
    props
  const nodeType = target.nodeType
  const set = (patch: Partial<WfNodeProps>) => onChange({ ...config, ...patch })

  if (tab === "advanced") {
    // 高级 tab：审批节点办理选项 + 审核菜单 + 超时（P2） + 节点事件（P3）
    if (nodeType === "approval") {
      return (
        <>
          <HandleOptionsSection
            value={config.handleOptions ?? defaultHandleOptions()}
            onChange={(handleOptions) => set({ handleOptions })}
          />
          <AuditMenuSection
            value={config.auditMenu ?? { allowJump: false, allowReturn: false }}
            onChange={(auditMenu) => set({ auditMenu })}
          />
          <TimeoutSection
            value={config.timeout ?? { hours: null, action: "NOTIFY", remindEvery: null }}
            onChange={(timeout) => set({ timeout })}
          />
          <NodeEventsSection value={config.events ?? []} onChange={(events) => set({ events })} />
        </>
      )
    }
    return (
      <div className="p-6 text-center text-xs text-muted-foreground">该节点暂无高级属性。</div>
    )
  }

  return (
    <>
      <Section title="基础信息" icon={Settings2}>
        <div className="space-y-1.5">
          <FieldLabel>节点名称</FieldLabel>
          <Input
            value={nodeName ?? ""}
            onChange={(e) => onNodeNameChange?.(e.target.value)}
            placeholder="请输入节点名称"
            className="h-8"
          />
        </div>
      </Section>

      {nodeType === "approval" && (
        <>
          <Section title="审批人规则" icon={ShieldCheck}>
            <AssigneeRulesEditor
              rules={config.assigneeRules ?? []}
              onChange={(assigneeRules) => set({ assigneeRules })}
              fields={formFields}
              nodeOptions={nodeOptions ?? []}
              variableOptions={(flowConfig?.variables ?? []).map((v) => v.name)}
            />
          </Section>

          <Section title="多人审批模式" icon={Users}>
            <RadioGroup
              value={config.multiMode ?? "ANY"}
              onValueChange={(v) => set({ multiMode: v as MultiMode })}
              className="gap-2"
            >
              {(Object.keys(MULTI_MODE_META) as MultiMode[]).map((mode) => (
                <label
                  key={mode}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors hover:bg-accent has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5"
                >
                  <RadioGroupItem value={mode} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">{MULTI_MODE_META[mode].label}</span>
                    <span className="block text-xs text-muted-foreground">{MULTI_MODE_META[mode].description}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </Section>

          {(config.multiMode ?? "ANY") === "VOTE" && (
            <VoteConfigSection
              value={config.voteConfig ?? defaultVoteConfig()}
              rules={config.assigneeRules ?? []}
              onChange={(voteConfig) => set({ voteConfig })}
            />
          )}

          <Section title="审批人为空时" icon={ArrowDownUp}>
            <Select
              value={config.emptyStrategy ?? "TO_ADMIN"}
              onValueChange={(v) => set({ emptyStrategy: v as EmptyStrategy })}
            >
              <SelectTrigger size="sm" className="h-8 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EMPTY_STRATEGY_META) as EmptyStrategy[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {EMPTY_STRATEGY_META[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>

          <Section title="按钮操作（白名单）" icon={ListChecks}>
            <p className="text-xs text-muted-foreground">开启的操作将出现在办理页工具栏。</p>
            <AllowedOpsEditor
              value={config.allowedOps ?? DEFAULT_ALLOWED_OPS}
              onChange={(allowedOps) => set({ allowedOps })}
            />
          </Section>

          <Section title="审批意见" icon={MessageSquare} defaultOpen={false}>
            <SwitchRow
              label="审批意见必填"
              description="办理时必须填写审批意见"
              checked={config.commentRequired ?? false}
              onCheckedChange={(v) => set({ commentRequired: v })}
            />
          </Section>

          <Section title="表单字段权限" icon={ListChecks} defaultOpen={false}>
            <FormPermsEditor
              value={config.formPerms ?? {}}
              onChange={(formPerms) => set({ formPerms })}
              fields={formFields}
            />
          </Section>
        </>
      )}

      {nodeType === "cc" && (
        <Section title="抄送人" icon={Send}>
          <CcUsersField value={config.ccUsers ?? []} onChange={(ccUsers) => set({ ccUsers })} />
        </Section>
      )}

      {nodeType === "condition" && (
        <Section title={branchMeta?.isDefault ? "默认分支" : "分支条件"} icon={GitFork}>
          <ConditionEditor
            condition={config.condition ?? { logic: "AND", items: [], isDefault: branchMeta?.isDefault ?? false }}
            onChange={(condition) => set({ condition })}
            fields={formFields}
          />
          {branchMeta && !branchMeta.isDefault && (
            <p className="text-xs text-muted-foreground">
              优先级 {branchMeta.priority}：按分支从左到右依次匹配，命中即进入。
            </p>
          )}
        </Section>
      )}
    </>
  )
}

/* ---------- 按钮操作白名单开关组 ---------- */

function AllowedOpsEditor({ value, onChange }: { value: AllowedOp[]; onChange: (ops: AllowedOp[]) => void }) {
  const toggle = (op: AllowedOp, on: boolean) =>
    onChange(on ? [...value.filter((o) => o !== op), op] : value.filter((o) => o !== op))
  return (
    <div className="space-y-2">
      {(Object.keys(ALLOWED_OP_META) as AllowedOp[]).map((op) => (
        <SwitchRow
          key={op}
          label={ALLOWED_OP_META[op].label}
          description={ALLOWED_OP_META[op].description}
          checked={value.includes(op)}
          onCheckedChange={(v) => toggle(op, v)}
        />
      ))}
    </div>
  )
}

/* ---------- 票签配置（multiMode=VOTE，我们的设计特色） ---------- */

function VoteConfigSection({
  value,
  rules,
  onChange,
}: {
  value: VoteConfig
  rules: AssigneeRule[]
  onChange: (v: VoteConfig) => void
}) {
  // 从办理人规则中收集 ACCOUNT 指定的具体成员（OrgPicker USER），供配权重
  const members = rules
    .filter((r) => r.kind === "ACCOUNT")
    .flatMap((r) => r.refs ?? [])
    .filter((ref) => ref.type === "USER" && ref.id > 0)
  const seen = new Set<number>()
  const uniqueMembers = members.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))

  const pct = Math.round((value.threshold ?? 0.5) * 100)
  const setThreshold = (p: number) => onChange({ ...value, threshold: Math.min(1, Math.max(0, p / 100)) })
  const weightOf = (userId: number) => value.weights.find((w) => w.userId === userId)?.weight ?? 1
  const setWeight = (userId: number, weight: number) => {
    const others = value.weights.filter((w) => w.userId !== userId)
    const next: VoteWeight[] = weight === 1 ? others : [...others, { userId, weight }]
    onChange({ ...value, weights: next })
  }

  return (
    <Section title="票签配置" icon={ListChecks}>
      <div className="space-y-2">
        <FieldLabel>通过阈值</FieldLabel>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={100}
            value={pct}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <Input
            type="number"
            min={1}
            max={100}
            value={pct}
            onChange={(e) => setThreshold(Number(e.target.value) || 0)}
            className="h-8 w-16 text-sm"
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
        <p className="text-xs text-muted-foreground">赞成权重占比超过 {pct}% 通过。</p>
      </div>

      <div className="space-y-1.5">
        <FieldLabel>成员权重（可选）</FieldLabel>
        {uniqueMembers.length === 0 ? (
          <p className="rounded-md border border-dashed py-2.5 text-center text-xs text-muted-foreground">
            办理人规则里用「指定人员」选择具体成员后，可在此为其配置权重
          </p>
        ) : (
          uniqueMembers.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs">{m.name}</span>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={weightOf(m.id)}
                onChange={(e) => setWeight(m.id, Math.max(0, Number(e.target.value) || 0))}
                className="h-8 w-20 text-sm"
              />
            </div>
          ))
        )}
        <p className="text-xs text-muted-foreground">未配的成员及运行时求值出的办理人默认权重 1。</p>
      </div>
    </Section>
  )
}

/* ---------- 办理选项（P2 全套，参考图23） ---------- */

function HandleOptionsSection({
  value,
  onChange,
}: {
  value: HandleOptions
  onChange: (opts: HandleOptions) => void
}) {
  const set = (patch: Partial<HandleOptions>) => onChange({ ...value, ...patch })
  return (
    <Section title="办理选项" icon={SlidersHorizontal}>
      <p className="text-xs text-muted-foreground">多人审批模式（或签/会签/依次/票签）统一在基础属性配置。</p>
      {HANDLE_OPTION_SWITCHES.map((sw) => (
        <SwitchRow
          key={sw.key}
          label={sw.label}
          description={sw.description}
          checked={Boolean(value[sw.key])}
          onCheckedChange={(v) => set({ [sw.key]: v } as Partial<HandleOptions>)}
        />
      ))}
    </Section>
  )
}

/* ---------- 审核菜单（是否允许跳转 / 退回） ---------- */

function AuditMenuSection({ value, onChange }: { value: AuditMenu; onChange: (v: AuditMenu) => void }) {
  return (
    <Section title="审核菜单" icon={GitFork} defaultOpen={false}>
      <SwitchRow
        label="允许跳转"
        description="办理时可跳转到指定节点"
        checked={Boolean(value.allowJump)}
        onCheckedChange={(v) => onChange({ ...value, allowJump: v })}
      />
      <SwitchRow
        label="允许退回"
        description="办理时可退回历史节点"
        checked={Boolean(value.allowReturn)}
        onCheckedChange={(v) => onChange({ ...value, allowReturn: v })}
      />
    </Section>
  )
}

/* ---------- 节点超时（P2） ---------- */

function TimeoutSection({ value, onChange }: { value: NodeTimeout; onChange: (v: NodeTimeout) => void }) {
  return (
    <Section title="超时设置" icon={Clock} defaultOpen={false}>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <FieldLabel>超时(小时)</FieldLabel>
          <Input
            type="number"
            min={0}
            value={value.hours ?? ""}
            onChange={(e) => onChange({ ...value, hours: e.target.value === "" ? null : Number(e.target.value) })}
            placeholder="不限"
            className="h-8"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>提醒间隔(小时)</FieldLabel>
          <Input
            type="number"
            min={0}
            value={value.remindEvery ?? ""}
            onChange={(e) => onChange({ ...value, remindEvery: e.target.value === "" ? null : Number(e.target.value) })}
            placeholder="不重复"
            className="h-8"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <FieldLabel>超时动作</FieldLabel>
        <Select value={value.action} onValueChange={(v) => onChange({ ...value, action: v as TimeoutAction })}>
          <SelectTrigger size="sm" className="h-8 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TIMEOUT_ACTION_META) as TimeoutAction[]).map((a) => (
              <SelectItem key={a} value={a}>
                {TIMEOUT_ACTION_META[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Section>
  )
}

/* ---------- 事件监听器：卡片式列表（NOTIFY / WEBHOOK / SCRIPT / API / DELEGATE） ---------- */

const API_METHODS: EventApiConfig["method"][] = ["GET", "POST", "PUT", "DELETE"]

/** 受信动作（配置入口需 wf:script:write 权限，无权只读） */
const TRUSTED_ACTIONS: ReadonlySet<EventAction> = new Set<EventAction>(["SCRIPT", "API", "DELEGATE"])

/**
 * 切换 action 时初始化对应载荷，并丢弃其它 action 的残留字段（序列化侧只带当前 action 字段）。
 * 保留 blocking（阻断开关随触发点/切动作沿用，仅切到非前置触发点时由 withTrigger 清理）。
 */
function withEventAction<E extends EventActionConfig>(ev: E, action: EventAction): E {
  const base: E = {
    ...ev,
    action,
    notify: undefined,
    webhookUrl: undefined,
    script: undefined,
    api: undefined,
    delegate: undefined,
  }
  switch (action) {
    case "NOTIFY":
      return { ...base, notify: ev.notify ?? { to: [], template: "" } }
    case "WEBHOOK":
      return { ...base, webhookUrl: ev.webhookUrl ?? "" }
    case "SCRIPT":
      return { ...base, script: ev.script ?? { lang: "groovy", code: "" } }
    case "API":
      return { ...base, api: ev.api ?? { method: "POST", url: "", headers: "", body: "" } }
    case "DELEGATE":
      return { ...base, delegate: ev.delegate ?? { bean: "" } }
    default:
      return base
  }
}

/** 切触发点：非前置触发点清掉 blocking（避免残留一个不生效的阻断标记） */
function withTrigger<T extends string, E extends EventActionConfig & { trigger: T }>(
  ev: E,
  trigger: T,
  blockingTriggers: ReadonlySet<T>,
): E {
  const next = { ...ev, trigger }
  if (!blockingTriggers.has(trigger)) next.blocking = undefined
  return next
}

/** 动作参数载荷编辑器（不含 action 下拉——由卡片上层渲染）；受信动作无权时只读 */
function EventActionPayload<E extends EventActionConfig>({
  value,
  onChange,
  canWriteTrusted,
}: {
  value: E
  onChange: (next: E) => void
  canWriteTrusted: boolean
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const api: EventApiConfig = value.api ?? { method: "POST", url: "", headers: "", body: "" }
  const setApi = (patch: Partial<EventApiConfig>) => onChange({ ...value, api: { ...api, ...patch } })
  const trustedReadonly = TRUSTED_ACTIONS.has(value.action) && !canWriteTrusted

  return (
    <>
      {value.action === "NOTIFY" && (
        <>
          <OrgPickerField
            value={value.notify?.to ?? []}
            multiple
            placeholder="通知对象"
            onOpen={() => setPickerOpen(true)}
            onRemove={(ref) =>
              onChange({
                ...value,
                notify: {
                  to: (value.notify?.to ?? []).filter((r) => !(r.type === ref.type && r.id === ref.id)),
                  template: value.notify?.template ?? "",
                },
              })
            }
          />
          <OrgPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            title="选择通知对象"
            value={value.notify?.to ?? []}
            onConfirm={(to) => onChange({ ...value, notify: { to, template: value.notify?.template ?? "" } })}
          />
          <Input
            value={value.notify?.template ?? ""}
            onChange={(e) =>
              onChange({ ...value, notify: { to: value.notify?.to ?? [], template: e.target.value } })
            }
            placeholder="通知模板"
            className="h-8 text-xs"
          />
        </>
      )}

      {value.action === "WEBHOOK" && (
        <Input
          value={value.webhookUrl ?? ""}
          onChange={(e) => onChange({ ...value, webhookUrl: e.target.value })}
          placeholder="Webhook 地址"
          className="h-8 text-xs"
        />
      )}

      {value.action === "SCRIPT" && (
        // ScriptEditor 自带 wf:script:write 只读门控
        <ScriptEditor
          value={value.script ?? { lang: "groovy", code: "" }}
          onChange={(script) => onChange({ ...value, script })}
        />
      )}

      {value.action === "API" && (
        <div className="space-y-2">
          {trustedReadonly && <TrustedReadonlyNote />}
          <div className="flex items-center gap-1.5">
            <Select
              value={api.method}
              onValueChange={(v) => setApi({ method: v as EventApiConfig["method"] })}
              disabled={trustedReadonly}
            >
              <SelectTrigger size="sm" className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={api.url}
              onChange={(e) => setApi({ url: e.target.value })}
              placeholder="请求 URL（支持模板变量）"
              className="h-8 flex-1 text-xs"
              disabled={trustedReadonly}
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>请求头（每行 Name: Value）</FieldLabel>
            {/* 统一 CodeEditor：Name:Value 列表非 JSON，用 text（无 lint，行号/折叠/查找/换行齐全） */}
            <CodeEditor
              value={api.headers ?? ""}
              onChange={(headers) => setApi({ headers })}
              language="text"
              readOnly={trustedReadonly}
              lineWrap
              minHeight="3rem"
              maxHeight="12rem"
              placeholder="每行一个 Name: Value，如 Content-Type: application/json"
              ariaLabel="请求头"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>请求体（JSON / 模板串）</FieldLabel>
            {/* 模板 JSON（含 ${...} 变量）：lint 关避免误报，保留着色/行号/折叠/查找 */}
            <CodeEditor
              value={api.body ?? ""}
              onChange={(body) => setApi({ body })}
              language="json"
              lint={false}
              readOnly={trustedReadonly}
              lineWrap
              expandable
              minHeight="4rem"
              maxHeight="16rem"
              placeholder={'{ "instanceId": "${instanceId}" }'}
              ariaLabel="请求体（模板 JSON）"
            />
          </div>
        </div>
      )}

      {value.action === "DELEGATE" && (
        <div className="space-y-1.5">
          {trustedReadonly && <TrustedReadonlyNote />}
          <FieldLabel>监听器 Bean 名</FieldLabel>
          <Input
            value={value.delegate?.bean ?? ""}
            onChange={(e) => onChange({ ...value, delegate: { bean: e.target.value } })}
            placeholder="如 demoBudgetGuard"
            className="h-8 font-mono text-xs"
            disabled={trustedReadonly}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            后端按名解析实现 <code className="font-mono">WfEventHandler</code> 的受信 Spring bean 并执行；治理同{" "}
            <code className="font-mono">wf:script:write</code>。
          </p>
        </div>
      )}
    </>
  )
}

/** 受信动作无权时的只读提示 */
function TrustedReadonlyNote() {
  return (
    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <AlertTriangle className="size-3.5 shrink-0" />
      只读：配置该动作需 <code className="font-mono">wf:script:write</code> 权限（仅受信管理员）。
    </p>
  )
}

/** 单张监听器卡：折叠态一行摘要（序号 + 触发点 + 动作 + 阻断标记），展开态编辑 */
function EventListenerCard<T extends string, E extends EventActionConfig & { trigger: T }>({
  index,
  value,
  triggerMeta,
  blockingTriggers,
  canWriteTrusted,
  onChange,
  onRemove,
}: {
  index: number
  value: E
  triggerMeta: Record<T, string>
  blockingTriggers: ReadonlySet<T>
  canWriteTrusted: boolean
  onChange: (next: E) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const isPreTrigger = blockingTriggers.has(value.trigger)
  const blocking = isPreTrigger && value.blocking === true

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("rounded-md border bg-card", blocking && "border-l-2 border-l-amber-500")}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] tabular-nums">
              {index + 1}
            </span>
            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
              {triggerMeta[value.trigger]}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              → {EVENT_ACTION_META[value.action]}
            </span>
            {blocking && (
              <span className="flex shrink-0 items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3" />
                阻断
              </span>
            )}
            <ChevronDown
              className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
            />
          </button>
        </CollapsibleTrigger>
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="删除监听器"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <CollapsibleContent className="space-y-2.5 border-t px-2.5 pb-2.5 pt-2">
        <div className="space-y-1">
          <FieldLabel>触发点</FieldLabel>
          <Select
            value={value.trigger}
            onValueChange={(v) => onChange(withTrigger(value, v as T, blockingTriggers))}
          >
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(triggerMeta) as T[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {triggerMeta[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <FieldLabel>动作</FieldLabel>
          <Select value={value.action} onValueChange={(v) => onChange(withEventAction(value, v as EventAction))}>
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(EVENT_ACTION_META) as EventAction[]).map((a) => (
                <SelectItem key={a} value={a}>
                  {EVENT_ACTION_META[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isPreTrigger && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2">
            <label className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                阻断办理
              </span>
              <Switch
                checked={value.blocking ?? false}
                onCheckedChange={(v) => onChange({ ...value, blocking: v || undefined })}
              />
            </label>
            <p className="mt-1 text-[11px] text-muted-foreground">该动作失败将中止本次办理（并回滚）。</p>
          </div>
        )}

        <div className="border-t pt-2 text-[11px] text-muted-foreground">—— 动作参数 ——</div>
        <EventActionPayload value={value} onChange={onChange} canWriteTrusted={canWriteTrusted} />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** 卡片式事件监听器列表（触发点/动作分行 + 阻断开关 + 增删），供节点事件 / 流程事件共用 */
function EventsSection<T extends string, E extends EventActionConfig & { trigger: T }>({
  hint,
  value,
  onChange,
  triggerMeta,
  blockingTriggers,
  makeDefault,
}: {
  hint: string
  value: E[]
  onChange: (v: E[]) => void
  triggerMeta: Record<T, string>
  blockingTriggers: ReadonlySet<T>
  /** 新增事件的默认值（由调用方按各自事件类型构造，避免泛型强转） */
  makeDefault: () => E
}) {
  const canWriteTrusted = useHasPerm("wf:script:write")
  const add = () => onChange([...value, makeDefault()])
  const update = (i: number, ev: E) => onChange(value.map((e, idx) => (idx === i ? ev : e)))
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))

  return (
    <Section title="事件监听器" icon={Zap} defaultOpen={false}>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="space-y-2">
        {value.map((ev, i) => (
          <EventListenerCard
            key={i}
            index={i}
            value={ev}
            triggerMeta={triggerMeta}
            blockingTriggers={blockingTriggers}
            canWriteTrusted={canWriteTrusted}
            onChange={(next) => update(i, next)}
            onRemove={() => remove(i)}
          />
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={add}>
        <Plus className="size-3" />
        添加监听器
      </Button>
    </Section>
  )
}

/* ---------- 节点事件（P3：后端真分发的 6 种触发点 × 5 种动作） ---------- */

function NodeEventsSection({ value, onChange }: { value: NodeEvent[]; onChange: (v: NodeEvent[]) => void }) {
  return (
    <EventsSection
      hint="在节点生命周期触发点执行 通知 / Webhook / 脚本 / API / 自定义监听器。前置触发点可开启阻断办理。"
      value={value}
      onChange={onChange}
      triggerMeta={EVENT_TRIGGER_META}
      blockingTriggers={BLOCKING_NODE_TRIGGERS}
      makeDefault={() => ({ trigger: "TASK_AFTER_COMPLETE", action: "NOTIFY", notify: { to: [], template: "" } })}
    />
  )
}

/* ---------- 流程事件（流程实例生命周期：启动 / 结束 / 撤销 × 5 种动作） ---------- */

function ProcessEventsSection({ value, onChange }: { value: ProcessEvent[]; onChange: (v: ProcessEvent[]) => void }) {
  return (
    <EventsSection
      hint="在流程实例生命周期触发点执行 通知 / Webhook / 脚本 / API / 自定义监听器。流程启动前可开启阻断发起。"
      value={value}
      onChange={onChange}
      triggerMeta={PROCESS_EVENT_TRIGGER_META}
      blockingTriggers={BLOCKING_PROCESS_TRIGGERS}
      makeDefault={() => ({ trigger: "PROCESS_START", action: "NOTIFY", notify: { to: [], template: "" } })}
    />
  )
}

/* ---------- 表单字段权限（P2） ---------- */

function FormPermsEditor({
  value,
  onChange,
  fields,
}: {
  value: Record<string, FormPerm>
  onChange: (v: Record<string, FormPerm>) => void
  fields: FormFieldOption[]
}) {
  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground">当前表单无字段。</p>
  }
  const set = (key: string, perm: FormPerm) => onChange({ ...value, [key]: perm })
  return (
    <div className="space-y-2">
      {fields.map((f) => (
        <div key={f.key} className="flex items-center gap-2">
          <span className="flex-1 truncate text-xs">{f.label}</span>
          <Select value={value[f.key] ?? "EDIT"} onValueChange={(v) => set(f.key, v as FormPerm)}>
            <SelectTrigger size="sm" className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FORM_PERM_META) as FormPerm[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {FORM_PERM_META[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  )
}

/* ---------- 流程变量（P3） ---------- */

function FlowVariablesEditor({
  value,
  onChange,
}: {
  value: FlowVariable[]
  onChange: (v: FlowVariable[]) => void
}) {
  const add = () => onChange([...value, { name: "", type: "STRING", defaultValue: "" }])
  const update = (i: number, v: FlowVariable) => onChange(value.map((it, idx) => (idx === i ? v : it)))
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  return (
    <div className="space-y-2">
      {value.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={v.name}
            onChange={(e) => update(i, { ...v, name: e.target.value })}
            placeholder="变量名"
            className="h-8 flex-1 text-xs"
          />
          <Select value={v.type} onValueChange={(t) => update(i, { ...v, type: t as FlowVarType })}>
            <SelectTrigger size="sm" className="h-8 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FLOW_VAR_TYPE_META) as FlowVarType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {FLOW_VAR_TYPE_META[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={v.defaultValue}
            onChange={(e) => update(i, { ...v, defaultValue: e.target.value })}
            placeholder="默认值"
            className="h-8 w-20 text-xs"
          />
          <button
            type="button"
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-500"
            onClick={() => remove(i)}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={add}>
        <Plus className="size-3" />
        添加变量
      </Button>
    </div>
  )
}
