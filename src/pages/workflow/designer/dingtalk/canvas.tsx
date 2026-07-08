/**
 * 仿钉钉审批流画布（从 demo/approval-flow 抽出的可复用核心）：
 * 基于 React Flow，自动布局、连线中点「+」插入节点、点击卡片回调配置。
 * 卡片摘要通过 render props 定制——demo 页展示人名摘要，
 * 流程定义设计器展示审批人规则/抄送/结构化条件摘要。
 */
import { createContext, useContext, useMemo, type ReactNode } from "react"
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  type EdgeProps,
  type EdgeTypes,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  Bot,
  ChevronRight,
  CircleCheck,
  CircleX,
  EllipsisVertical,
  GitFork,
  GitMerge,
  Plus,
  Send,
  Split,
  Timer,
  Trash2,
  UserCheck,
  UserRound,
  Workflow,
  X,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { buildFlow } from "./layout"
import type { ApprovalStep, Branch, CcStep, LeafStep, StepKind, StepNode } from "./model"

/* ---------- 叶子节点类型 → 卡片头样式（图标 / 配色） ---------- */

type LeafKind = LeafStep["kind"]

export const LEAF_STYLE: Record<LeafKind, { icon: typeof UserCheck; header: string; hint: string; hintClass: string }> = {
  approval: { icon: UserCheck, header: "bg-orange-500", hint: "请设置审批人", hintClass: "text-orange-500" },
  cc: { icon: Send, header: "bg-sky-500", hint: "请设置抄送人", hintClass: "text-sky-600" },
  subprocess: { icon: Workflow, header: "bg-indigo-500", hint: "请选择子流程", hintClass: "text-indigo-500" },
  timer: { icon: Timer, header: "bg-amber-500", hint: "请设置等待时间", hintClass: "text-amber-600" },
  trigger: { icon: Zap, header: "bg-fuchsia-500", hint: "请设置触发器", hintClass: "text-fuchsia-500" },
  ai: { icon: Bot, header: "bg-violet-500", hint: "请配置 AI 审批", hintClass: "text-violet-500" },
  autoApprove: { icon: CircleCheck, header: "bg-teal-500", hint: "到达自动通过", hintClass: "text-teal-600" },
  autoReject: { icon: CircleX, header: "bg-rose-500", hint: "到达自动拒绝", hintClass: "text-rose-600" },
}

/* ---------- 节点/边与外层通信的动作上下文 ---------- */

export interface FlowActions {
  insert: (listId: string, index: number, kind: StepKind) => void
  openStepConfig: (stepId: string) => void
  openBranchConfig: (branchId: string) => void
  deleteStep: (stepId: string) => void
  deleteBranch: (conditionId: string, branchId: string) => void
  addBranchTo: (conditionId: string) => void
}

const FlowActionsContext = createContext<FlowActions | null>(null)
const useFlowActions = () => {
  const ctx = useContext(FlowActionsContext)
  if (!ctx) throw new Error("FlowActionsContext missing")
  return ctx
}

/* ---------- 摘要渲染定制 ---------- */

/** 分支容器类型（条件/包容/并行）——供分支卡片摘要区分渲染 */
export type ContainerKind = "condition" | "inclusive" | "parallel"

interface FlowRenderers {
  renderStepSummary: (step: LeafStep) => ReactNode
  renderBranchSummary: (branch: Branch, isDefault: boolean, containerKind?: ContainerKind) => ReactNode
}

/** 默认摘要：与原 demo 一致（人名头像 + 或签/会签 / 条件表达式文本） */
export function defaultStepSummary(step: LeafStep): ReactNode {
  if (step.kind !== "approval" && step.kind !== "cc") {
    // P3 高级节点：默认摘要占位（流程定义设计器覆写 renderStepSummary 展示详细配置）
    return <span className={cn("text-sm", LEAF_STYLE[step.kind].hintClass)}>{LEAF_STYLE[step.kind].hint}</span>
  }
  const isApproval = step.kind === "approval"
  const people = isApproval ? (step as ApprovalStep).assignees : (step as CcStep).users
  if (people.length === 0) {
    return (
      <span className={cn("text-sm", isApproval ? "text-orange-500" : "text-sky-600")}>
        {isApproval ? "请设置审批人" : "请设置抄送人"}
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="flex shrink-0 -space-x-1">
        {people.slice(0, 3).map((name) => (
          <Avatar key={name} className="size-5 border border-background">
            <AvatarFallback className="bg-primary/10 text-[9px] text-primary">{name.charAt(0)}</AvatarFallback>
          </Avatar>
        ))}
      </span>
      <span className="truncate text-sm">
        {people.join("、")}
        {isApproval && (
          <span className="ml-1 text-xs text-muted-foreground">
            ({(step as ApprovalStep).mode === "any" ? "或签" : "会签"})
          </span>
        )}
      </span>
    </span>
  )
}

export function defaultBranchSummary(branch: Branch, isDefault: boolean, containerKind?: ContainerKind): ReactNode {
  if (containerKind === "parallel") {
    return <span className="text-sm text-sky-600">并行执行（无条件）</span>
  }
  return branch.condition ? (
    <span className="truncate text-sm">{branch.condition}</span>
  ) : (
    <span className="text-sm text-emerald-600">{isDefault ? "其他情况进入此分支" : "请设置条件"}</span>
  )
}

const FlowRenderersContext = createContext<FlowRenderers>({
  renderStepSummary: defaultStepSummary,
  renderBranchSummary: defaultBranchSummary,
})

/* ---------- 自定义节点 ---------- */

function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} className="opacity-0!" />
      <Handle type="source" position={Position.Bottom} className="opacity-0!" />
    </>
  )
}

function StartNode() {
  return (
    <div className="w-64 overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex h-8 items-center gap-1.5 bg-slate-500 px-3 text-xs font-medium text-white">
        <UserRound className="size-3.5" />
        发起人
      </div>
      <div className="px-3 py-2.5 text-sm text-muted-foreground">全体员工</div>
      <NodeHandles />
    </div>
  )
}

function EndNode() {
  return (
    <div className="flex w-64 items-center justify-center rounded-lg border bg-muted/60 py-2.5 text-sm text-muted-foreground shadow-sm">
      流程结束
      <NodeHandles />
    </div>
  )
}

function DotNode() {
  return (
    <div className="size-3 rounded-full border-2 border-border bg-background">
      <NodeHandles />
    </div>
  )
}

function StepNodeCard({ data }: NodeProps) {
  const actions = useFlowActions()
  const { renderStepSummary } = useContext(FlowRenderersContext)
  const step = (data as { step: LeafStep }).step
  const style = LEAF_STYLE[step.kind]
  const Icon = style.icon

  return (
    <div
      className="group w-64 cursor-pointer overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md"
      onClick={() => actions.openStepConfig(step.id)}
    >
      <div className={cn("flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-white", style.header)}>
        <Icon className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">{step.name}</span>
        <button
          type="button"
          className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/20 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            actions.deleteStep(step.id)
          }}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        {renderStepSummary(step)}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
      </div>
      <NodeHandles />
    </div>
  )
}

function BranchNode({ data }: NodeProps) {
  const actions = useFlowActions()
  const { renderBranchSummary } = useContext(FlowRenderersContext)
  const { branch, conditionId, containerKind, priority, branchCount, isDefault } = data as {
    branch: Branch
    conditionId: string
    containerKind: ContainerKind
    priority: number
    branchCount: number
    isDefault: boolean
  }
  const parallel = containerKind === "parallel"
  const headStyle = parallel
    ? { wrap: "bg-sky-500/10 text-sky-600", badge: "border-sky-500/30 text-sky-600", hover: "hover:bg-sky-500/20" }
    : { wrap: "bg-emerald-500/10 text-emerald-600", badge: "border-emerald-500/30 text-emerald-600", hover: "hover:bg-emerald-500/20" }
  const HeadIcon = parallel ? Split : containerKind === "inclusive" ? GitMerge : GitFork

  return (
    <div
      className="group w-64 cursor-pointer overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md"
      onClick={() => actions.openBranchConfig(branch.id)}
    >
      <div className={cn("flex h-8 items-center gap-1.5 border-b px-3 text-xs font-medium", headStyle.wrap)}>
        <HeadIcon className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">{branch.name}</span>
        <Badge variant="outline" className={cn("h-4.5 px-1 text-[10px]", headStyle.badge)}>
          {parallel ? `并行 ${priority}` : `优先级 ${priority}`}
        </Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="分支操作"
              className={cn("rounded p-0.5 opacity-60 transition-opacity hover:opacity-100", headStyle.hover)}
              onClick={(e) => e.stopPropagation()}
            >
              <EllipsisVertical className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem
              className="text-xs"
              onClick={(e) => {
                e.stopPropagation()
                actions.addBranchTo(conditionId)
              }}
            >
              <Plus className="size-3.5" /> 添加分支
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              disabled={branchCount <= 2}
              title={branchCount <= 2 ? "仅两条分支时请用「删除整个分支」" : undefined}
              onClick={(e) => {
                e.stopPropagation()
                actions.deleteBranch(conditionId, branch.id)
              }}
            >
              <X className="size-3.5" /> 删除本分支
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="text-xs"
              onClick={(e) => {
                e.stopPropagation()
                actions.deleteStep(conditionId)
              }}
            >
              <Trash2 className="size-3.5" /> 删除整个分支
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        {renderBranchSummary(branch, isDefault, containerKind)}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
      </div>
      <NodeHandles />
    </div>
  )
}

const nodeTypes: NodeTypes = {
  start: StartNode,
  end: EndNode,
  dot: DotNode,
  step: StepNodeCard,
  branch: BranchNode,
}

/* ---------- 自定义边：中点带「+」插入按钮 ---------- */

function InsertEdge({ id, sourceX, sourceY, targetX, targetY, style, data }: EdgeProps) {
  const actions = useFlowActions()
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Bottom,
    targetX,
    targetY,
    targetPosition: Position.Top,
    borderRadius: 8,
  })
  const { listId, index } = data as { listId: string; index: number }

  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="pointer-events-auto absolute z-10"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:border-primary hover:text-primary"
              >
                <Plus className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-36">
              <DropdownMenuLabel className="text-xs text-muted-foreground">添加节点</DropdownMenuLabel>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "approval")}>
                <UserCheck className="size-3.5 text-orange-500" /> 审批人
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "cc")}>
                <Send className="size-3.5 text-sky-500" /> 抄送人
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "condition")}>
                <GitFork className="size-3.5 text-emerald-500" /> 条件分支
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "parallel")}>
                <Split className="size-3.5 text-sky-500" /> 并行分支
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "inclusive")}>
                <GitMerge className="size-3.5 text-emerald-500" /> 包容分支
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">高级</DropdownMenuLabel>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "subprocess")}>
                <Workflow className="size-3.5 text-indigo-500" /> 子流程
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "timer")}>
                <Timer className="size-3.5 text-amber-500" /> 定时
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "trigger")}>
                <Zap className="size-3.5 text-fuchsia-500" /> 触发器
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "ai")}>
                <Bot className="size-3.5 text-violet-500" /> AI 审批
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "autoApprove")}>
                <CircleCheck className="size-3.5 text-teal-500" /> 自动通过
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => actions.insert(listId, index, "autoReject")}>
                <CircleX className="size-3.5 text-rose-500" /> 自动拒绝
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

const edgeTypes: EdgeTypes = { insert: InsertEdge }

/* ---------- 画布组件 ---------- */

export interface ApprovalFlowCanvasProps {
  steps: StepNode[]
  actions: FlowActions
  renderStepSummary?: (step: LeafStep) => ReactNode
  renderBranchSummary?: (branch: Branch, isDefault: boolean, containerKind?: ContainerKind) => ReactNode
  /** 点击画布空白处（用于选中流程级属性） */
  onPaneClick?: () => void
}

export function ApprovalFlowCanvas({
  steps,
  actions,
  renderStepSummary = defaultStepSummary,
  renderBranchSummary = defaultBranchSummary,
  onPaneClick,
}: ApprovalFlowCanvasProps) {
  const dark = isDarkMode(useAppStore((s) => s.themeMode))
  const { nodes, edges } = useMemo(() => buildFlow(steps), [steps])
  const renderers = useMemo(
    () => ({ renderStepSummary, renderBranchSummary }),
    [renderStepSummary, renderBranchSummary],
  )

  return (
    <FlowActionsContext.Provider value={actions}>
      <FlowRenderersContext.Provider value={renderers}>
        <ReactFlowProvider>
          <ReactFlow
            colorMode={dark ? "dark" : "light"}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            deleteKeyCode={null}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
            minZoom={0.3}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </FlowRenderersContext.Provider>
    </FlowActionsContext.Provider>
  )
}
