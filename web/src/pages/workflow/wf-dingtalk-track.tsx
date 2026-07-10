/**
 * 只读钉钉风格流程跟踪图：复用 designer/dingtalk 的 layout/model/serialize 渲染 designerJson 节点树，
 * 按 highlight.completed(绿)/active(蓝脉冲) 高亮对应节点 id。
 *
 * 与设计器画布（canvas.tsx）区别：无编辑（不插入/不删除/不打开属性面板），节点不可拖拽/连接。
 * 高亮映射：钉钉节点 id = 后端转换器生成的 BPMN activity id（mgr/gm/cc1…），highlight 直接可用；
 * BPMN 特有网关/连线 id 在钉钉模型无对应，忽略。
 */
import { useMemo } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { GitBranch, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import type { WfHighlight } from "@/types/workflow"
import { LEAF_STYLE } from "./designer/dingtalk/canvas"
import { buildFlow } from "./designer/dingtalk/layout"
import type { ApprovalStep, Branch, CcStep, LeafStep, StepNode } from "./designer/dingtalk/model"
import { deserializeDingtalk, isBackendDesignerJson } from "./designer/dingtalk/serialize"

type TrackStatus = "completed" | "active" | undefined

/** 高亮脉冲动画（进行中节点）；与 BpmnTrack 语义一致：绿=已完成、主题色脉冲=进行中 */
const TRACK_CSS = `
@keyframes wf-dt-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--primary); }
  50% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 35%, transparent); }
}
.wf-dt-active-card { animation: wf-dt-pulse 1.6s ease-in-out infinite; }
`

function statusRing(status: TrackStatus): string {
  if (status === "completed") return "ring-2 ring-emerald-500"
  if (status === "active") return "ring-2 ring-primary wf-dt-active-card"
  return ""
}

function StatusBadge({ status }: { status: TrackStatus }) {
  if (status === "completed") {
    return <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600">已完成</span>
  }
  if (status === "active") {
    return <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">进行中</span>
  }
  return null
}

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
        <UserRound className="size-3.5" /> 发起人
      </div>
      <div className="px-3 py-2.5 text-sm text-muted-foreground">发起申请</div>
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

/** 审批/抄送等叶子节点摘要（只读）：办理人名单 / 或签会签 / 高级节点提示 */
function stepSummary(step: LeafStep) {
  if (step.kind === "approval" || step.kind === "cc") {
    const isApproval = step.kind === "approval"
    const people = isApproval ? (step as ApprovalStep).assignees : (step as CcStep).users
    const modeText = isApproval ? ((step as ApprovalStep).mode === "any" ? "或签" : "会签") : "抄送"
    return (
      <span className="truncate text-sm text-muted-foreground">
        {people.length ? people.join("、") : modeText}
        {isApproval && <span className="ml-1 text-xs opacity-70">({modeText})</span>}
      </span>
    )
  }
  return <span className="text-sm text-muted-foreground">{LEAF_STYLE[step.kind].hint.replace("请设置", "").replace("请选择", "").replace("请配置", "") || step.name}</span>
}

function StepNodeCard({ data }: NodeProps) {
  const { step, status } = data as { step: LeafStep; status: TrackStatus }
  const style = LEAF_STYLE[step.kind]
  const Icon = style.icon
  return (
    <div className={cn("w-64 overflow-hidden rounded-lg border bg-card shadow-sm", statusRing(status))}>
      <div className={cn("flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-white", style.header)}>
        <Icon className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">{step.name}</span>
        <StatusBadge status={status} />
      </div>
      <div className="px-3 py-2.5">{stepSummary(step)}</div>
      <NodeHandles />
    </div>
  )
}

function BranchNode({ data }: NodeProps) {
  const { branch, isDefault, priority, status } = data as {
    branch: Branch
    isDefault: boolean
    priority: number
    status: TrackStatus
  }
  return (
    <div className={cn("w-64 overflow-hidden rounded-lg border bg-card shadow-sm", statusRing(status))}>
      <div className="flex h-8 items-center gap-1.5 border-b bg-emerald-500/10 px-3 text-xs font-medium text-emerald-600">
        <GitBranch className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">{branch.name}</span>
        <span className="shrink-0 rounded border border-emerald-500/30 px-1 text-[10px] text-emerald-600">优先级 {priority}</span>
      </div>
      <div className="px-3 py-2.5 text-sm text-muted-foreground">
        {branch.condition || (isDefault ? "其他情况进入此分支" : "条件分支")}
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

/** designerJson（后端 { nodes, flowConfig } 对象或其 JSON 字符串）→ 步骤树 */
function parseSteps(designerJson: unknown): StepNode[] {
  let obj = designerJson
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj)
    } catch {
      return []
    }
  }
  if (!isBackendDesignerJson(obj)) return []
  try {
    return deserializeDingtalk(obj).steps
  } catch {
    return []
  }
}

export function DingtalkTrack({ designerJson, highlight }: { designerJson: unknown; highlight?: WfHighlight }) {
  const dark = isDarkMode(useAppStore((s) => s.themeMode))

  const { nodes, edges, empty } = useMemo(() => {
    const steps = parseSteps(designerJson)
    if (steps.length === 0) return { nodes: [] as Node[], edges: [] as Edge[], empty: true }
    const completed = new Set(highlight?.completed ?? [])
    const active = new Set(highlight?.active ?? [])
    const statusOf = (id: string): TrackStatus =>
      active.has(id) ? "active" : completed.has(id) ? "completed" : undefined

    const built = buildFlow(steps)
    const outNodes: Node[] = built.nodes.map((n) => ({
      ...n,
      // 高亮：按节点 id 命中 active/completed；start/end/dot 无对应 activity id，保持中性
      data: { ...n.data, status: statusOf(n.id) },
    }))
    // 去掉设计器的「+」插入边，统一为普通折线（只读）
    const outEdges: Edge[] = built.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      style: { stroke: "var(--border)", strokeWidth: 1.5 },
    }))
    return { nodes: outNodes, edges: outEdges, empty: false }
  }, [designerJson, highlight])

  if (empty) {
    return (
      <div className="flex h-105 flex-col items-center justify-center gap-2 text-muted-foreground">
        <GitBranch className="size-8 opacity-30" />
        <span className="text-sm">暂无流程图</span>
      </div>
    )
  }

  const legend = (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-4 rounded-md border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border-2 border-emerald-500" /> 已完成
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 animate-pulse rounded-sm border-2 border-primary" /> 进行中
      </span>
      <span className="hidden opacity-70 sm:inline">· 滚轮缩放 · 拖拽平移</span>
    </div>
  )

  return (
    <div className="wf-dt-track relative h-105 w-full rounded-md border bg-background">
      <style>{TRACK_CSS}</style>
      <ReactFlowProvider>
        <ReactFlow
          colorMode={dark ? "dark" : "light"}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
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
      {legend}
    </div>
  )
}
