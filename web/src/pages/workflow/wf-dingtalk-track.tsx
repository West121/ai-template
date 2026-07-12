/**
 * 只读钉钉风格流程跟踪图：复用 designer/dingtalk 的 layout/model/serialize 渲染 designerJson 节点树，
 * 按 highlight.completed(绿)/active(蓝脉冲) 高亮对应节点 id。
 *
 * 与设计器画布（canvas.tsx）区别：无编辑（不插入/不删除/不打开属性面板），节点不可拖拽/连接。
 * 高亮映射：钉钉节点 id = 后端转换器生成的 BPMN activity id（mgr/gm/cc1…），highlight 直接可用；
 * BPMN 特有网关/连线 id 在钉钉模型无对应，忽略。
 */
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
import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Circle, Clock, GitBranch, Loader2, Play, RotateCcw, Sparkles, Square, Users, UserPlus, UserRound, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { Button } from "@/components/ui/button"
import type { WfHighlight } from "@/types/workflow"
import { LEAF_STYLE } from "./designer/dingtalk/canvas"
import { buildFlow } from "./designer/dingtalk/layout"
import type { ApprovalStep, Branch, CcStep, LeafStep, StepNode } from "./designer/dingtalk/model"
import { deserializeDingtalk, isBackendDesignerJson } from "./designer/dingtalk/serialize"
import { forwardReachable, reachableAncestors, type NodeRuntimeInfo, type NodeRuntimeStatus } from "./designer/flow/runtime-info"
import type { FlowPredict } from "./designer/flow/flow-viewer"

/** 运行时节点状态（highlight 的 completed/active + timeline 派生的 rejected/addSign） */
type TrackStatus = NodeRuntimeStatus | undefined

/** 高亮脉冲 + 预测虚线呼吸 + 回放过边流光（单次，克制）；与 FlowViewer 语义一致 */
const TRACK_CSS = `
@keyframes wf-dt-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--primary); }
  50% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 35%, transparent); }
}
.wf-dt-active-card { animation: wf-dt-pulse 1.6s ease-in-out infinite; }
@keyframes wf-dt-predict-breathe { 0%,100% { outline-color: #60a5fa; } 50% { outline-color: color-mix(in srgb, #60a5fa 40%, transparent); } }
.wf-dt-predicted-card { animation: wf-dt-predict-breathe 2s ease-in-out infinite; }
@keyframes wf-dt-edge-flow-dash { to { stroke-dashoffset: -20; } }
/* 回放：走过的边单次流光扫过 */
.wf-dt-track .wf-dt-edge-flow .react-flow__edge-path { stroke-dasharray: 8 4; animation: wf-dt-edge-flow-dash 0.6s linear 2; }
/* 常态：已走过路径虚线持续流动（专业克制，慢速；reduce-motion 降级静态） */
.wf-dt-track .wf-dt-edge-loop .react-flow__edge-path { animation: wf-dt-edge-flow-dash 1.1s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .wf-dt-track .wf-dt-active-card,
  .wf-dt-track .wf-dt-predicted-card,
  .wf-dt-track .wf-dt-edge-flow .react-flow__edge-path,
  .wf-dt-track .wf-dt-edge-loop .react-flow__edge-path { animation: none; }
}
`

/** 状态 → 环色（与 FlowViewer 五态一致：进行中蓝脉冲/已通过绿/驳回红/加签紫/未到达无） */
function statusRing(status: TrackStatus): string {
  if (status === "active") return "ring-2 ring-primary wf-dt-active-card"
  if (status === "completed") return "ring-2 ring-emerald-500"
  if (status === "rejected") return "ring-2 ring-rose-500"
  if (status === "addSign") return "ring-2 ring-violet-500"
  return ""
}

const STATUS_META: Record<NodeRuntimeStatus, { label: string; cls: string }> = {
  notReached: { label: "未到达", cls: "bg-muted text-muted-foreground" },
  active: { label: "进行中", cls: "bg-primary/10 text-primary" },
  completed: { label: "已通过", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  rejected: { label: "驳回", cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  addSign: { label: "加签", cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
}

function StatusIcon({ status }: { status: NodeRuntimeStatus }) {
  if (status === "completed") return <CheckCircle2 className="size-3" />
  if (status === "rejected") return <XCircle className="size-3" />
  if (status === "addSign") return <UserPlus className="size-3" />
  if (status === "active") return <Clock className="size-3" />
  return <Circle className="size-3" />
}

/** 状态角标（钉钉卡头部）：五态图标 + 文案 */
function StatusBadge({ status }: { status: TrackStatus }) {
  if (!status || status === "notReached") return null
  const m = STATUS_META[status]
  return (
    <span className={cn("flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px]", m.cls)}>
      <StatusIcon status={status} /> {m.label}
    </span>
  )
}

function shortTime(t?: string): string {
  if (!t) return ""
  const s = t.replace("T", " ")
  return s.length >= 16 ? s.slice(5, 16) : s
}

/** 已办办理人明细（① 节点办理信息）：办理人名·时间 + 意见摘要（多人列全部；title 提供完整意见） */
function HandledInfo({ info }: { info?: NodeRuntimeInfo }) {
  if (!info || info.assignees.length === 0) return null
  return (
    <div className="space-y-1 border-t bg-muted/20 px-3 py-1.5">
      {info.assignees.map((a, i) => (
        <div key={i} className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-medium text-primary">
              {a.name.slice(0, 1)}
            </span>
            <span className="truncate text-xs font-medium">{a.name}</span>
            {a.time && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{shortTime(a.time)}</span>}
          </div>
          {a.opinion && (
            <p className="truncate pl-5.5 text-[10px] text-muted-foreground" title={a.opinion}>
              {a.opinion}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} className="opacity-0!" />
      <Handle type="source" position={Position.Bottom} className="opacity-0!" />
    </>
  )
}

function StartNode({ data }: NodeProps) {
  const { info, status } = data as { info?: NodeRuntimeInfo; status?: TrackStatus }
  return (
    <div className={cn("w-64 overflow-hidden rounded-lg border bg-card shadow-sm", statusRing(status ?? info?.status))}>
      <div className="flex h-8 items-center gap-1.5 bg-slate-500 px-3 text-xs font-medium text-white">
        <UserRound className="size-3.5" /> <span className="flex-1">发起人</span>
        <StatusBadge status={status ?? info?.status} />
      </div>
      <div className="px-3 py-2.5 text-sm text-muted-foreground">发起申请</div>
      <HandledInfo info={info} />
      <NodeHandles />
    </div>
  )
}

/** 并签模式标签 */
function multiModeLabel(m: string): string {
  return m === "ALL" ? "会签·全部" : m === "ANY" ? "或签·一人" : m === "SEQUENCE" ? "顺序审批" : m === "VOTE" ? "投票" : m
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
  const { step, status, info, predicted, predictNames, canReject, rejectToName, multiMode, parallelGroup } = data as {
    step: LeafStep
    status: TrackStatus
    info?: NodeRuntimeInfo
    predicted?: boolean
    predictNames?: string[]
    canReject?: boolean
    rejectToName?: string
    multiMode?: string
    parallelGroup?: string
  }
  const style = LEAF_STYLE[step.kind]
  const Icon = style.icon
  const showMeta = step.kind === "approval" && (multiMode || canReject || parallelGroup)
  return (
    <div
      className={cn(
        "w-64 overflow-hidden rounded-lg border bg-card shadow-sm",
        statusRing(status),
        // ③ 预测节点：蓝色虚线（区别已完成绿实线）
        predicted && "outline outline-2 outline-dashed outline-offset-2 outline-blue-400 wf-dt-predicted-card",
      )}
    >
      <div className={cn("flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-white", style.header)}>
        <Icon className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">{step.name}</span>
        {predicted ? (
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-white/20 px-1.5 py-0.5 text-[10px]">
            <Sparkles className="size-2.5" /> 预计
          </span>
        ) : (
          <StatusBadge status={status} />
        )}
      </div>
      {/* ④ 并签模式 + ② 可驳回标记 + ③ 并行分组（预测态标注） */}
      {showMeta && (
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/20 px-3 py-1 text-[10px]">
          {multiMode && (
            <span className="flex items-center gap-0.5 rounded bg-slate-500/10 px-1 py-0.5 text-slate-600 dark:text-slate-300">
              <Users className="size-2.5" /> {multiModeLabel(multiMode)}
            </span>
          )}
          {parallelGroup && (
            <span className="rounded bg-indigo-500/10 px-1 py-0.5 text-indigo-600 dark:text-indigo-300">并行</span>
          )}
          {canReject && (
            <span
              className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1 py-0.5 text-amber-600 dark:text-amber-400"
              title={`驳回将回到 ${rejectToName ?? "发起人"}`}
            >
              <RotateCcw className="size-2.5" /> 可驳回
            </span>
          )}
        </div>
      )}
      <div className="px-3 py-2.5">{stepSummary(step)}</div>
      {/* ③ 预测节点/当前活动节点的预计办理人（无实际办理记录时补充展示） */}
      {predictNames && predictNames.length > 0 && (
        <div className="flex items-center gap-1 border-t border-blue-400/30 bg-blue-50/60 px-3 py-1.5 text-[11px] text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
          <Sparkles className="size-3 shrink-0" />
          <span className="min-w-0 truncate">预计 {predictNames.join("、")}</span>
        </div>
      )}
      {/* ① 节点办理信息：已办办理人·时间·意见（timeline 派生，非设计态候选人） */}
      <HandledInfo info={info} />
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

const REPLAY_STEP_MS = 750
const PREDICT_STEP_MS = 650
const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

export function DingtalkTrack({
  designerJson,
  highlight,
  nodeInfo,
  replaySteps,
  predict,
  onRequestPredict,
  predictLoading,
}: {
  designerJson: unknown
  highlight?: WfHighlight
  /** ① 节点办理信息 nodeId→info（timeline 映射；缺省则只按 highlight 高亮） */
  nodeInfo?: Record<string, NodeRuntimeInfo>
  /** ② 回放：时间序 nodeId 序列（≥2 才显「回放」） */
  replaySteps?: string[]
  /** ③ 预测数据（/predict 结果归一）；null=未拉取 */
  predict?: FlowPredict | null
  /** ③ 触发拉取预测 */
  onRequestPredict?: () => void
  predictLoading?: boolean
}) {
  const dark = isDarkMode(useAppStore((s) => s.themeMode))
  const replaySeq = useMemo(() => replaySteps ?? [], [replaySteps])
  const canReplay = replaySeq.length >= 2

  // ② 回放 / ③ 预测播放状态机（与 FlowViewer 同：手动触发、单次、reduce-motion 直接终态）
  const [replay, setReplay] = useState<number | null>(null)
  const [predictPlay, setPredictPlay] = useState<number | null>(null)
  useEffect(() => {
    if (replay === null) return
    if (replay >= replaySeq.length || prefersReducedMotion()) {
      setReplay(null)
      return
    }
    const t = window.setTimeout(() => setReplay((r) => (r === null ? null : r + 1)), REPLAY_STEP_MS)
    return () => window.clearTimeout(t)
  }, [replay, replaySeq.length])
  useEffect(() => {
    if (predictPlay === null || !predict) return
    if (predictPlay >= predict.nodes.length || prefersReducedMotion()) {
      setPredictPlay(null)
      return
    }
    const t = window.setTimeout(() => setPredictPlay((p) => (p === null ? null : p + 1)), PREDICT_STEP_MS)
    return () => window.clearTimeout(t)
  }, [predictPlay, predict])
  const startReplay = () => {
    setPredictPlay(null)
    if (!canReplay || prefersReducedMotion()) return
    setReplay(0)
  }
  const startPredictPlay = () => {
    setReplay(null)
    if (!predict || predict.nodes.length === 0 || prefersReducedMotion()) return
    setPredictPlay(0)
  }

  // 预测链路顺序 + 已揭示集合（静态=全量；播放中=逐个揭示，结构节点随其步骤节点揭示自然点亮）
  const predictOrder = useMemo(() => predict?.nodes.map((n) => n.nodeId) ?? [], [predict])
  const predictRevealed = useMemo(() => {
    if (!predict) return new Set<string>()
    const n = predictPlay === null ? predictOrder.length : Math.min(predictPlay + 1, predictOrder.length)
    return new Set(predictOrder.slice(0, n))
  }, [predict, predictPlay, predictOrder])

  const { nodes, edges, empty } = useMemo(() => {
    const parsedSteps = parseSteps(designerJson)
    if (parsedSteps.length === 0) return { nodes: [] as Node[], edges: [] as Edge[], empty: true }
    const completed = new Set(highlight?.completed ?? [])
    const active = new Set(highlight?.active ?? [])
    const replaying = replay !== null
    const predicting = !replaying && !!predict
    const walked = replaying ? new Set(replaySeq.slice(0, replay)) : null
    const activeStep = replaying && replay < replaySeq.length ? replaySeq[replay] : null

    const statusOf = (id: string): TrackStatus => {
      if (replaying) {
        if (id === activeStep) return "active"
        if (walked?.has(id)) return "completed"
        return undefined
      }
      return nodeInfo?.[id]?.status ?? (active.has(id) ? "active" : completed.has(id) ? "completed" : undefined)
    }

    const built = buildFlow(parsedSteps)

    /* ---------------- 常态「走过路径」（反向回溯祖先；条件分支只亮命中支，并行汇聚都亮） ---------------- */
    let walkedNodes = new Set<string>()
    const activeNodeSet = new Set<string>()
    if (!replaying && !predicting) {
      const reached = built.nodes.filter((n) => statusOf(n.id)).map((n) => n.id)
      walkedNodes = reachableAncestors(built.edges, reached)
      for (const n of built.nodes) if (statusOf(n.id) === "active") activeNodeSet.add(n.id)
    }

    /* ---------------- 预测态「完整链路」（done+current+future，从头到尾） ---------------- */
    const predictById = new Map((predict?.nodes ?? []).map((n) => [n.nodeId, n]))
    let doneChain = new Set<string>()
    let futureFwd = new Set<string>()
    let currentPSet = new Set<string>()
    if (predicting && predict) {
      const seeds = predict.nodes.filter((n) => (n.status === "done" || n.status === "current") && predictRevealed.has(n.nodeId)).map((n) => n.nodeId)
      currentPSet = new Set(predict.nodes.filter((n) => n.status === "current" && predictRevealed.has(n.nodeId)).map((n) => n.nodeId))
      doneChain = reachableAncestors(built.edges, seeds) // done+current 段（含结构节点）
      futureFwd = forwardReachable(built.edges, [...currentPSet]) // 当前节点正向 → 后续段
    }

    // 节点视觉态：predict态按链路状态（done绿/current进行中/future蓝虚线），否则回放/常态 statusOf
    const nodeVisual = (id: string): { status: TrackStatus; predicted: boolean } => {
      if (predicting) {
        const pn = predictById.get(id)
        if (pn && predictRevealed.has(id)) {
          if (pn.status === "done") return { status: "completed", predicted: false }
          if (pn.status === "current") return { status: "active", predicted: false }
          return { status: undefined, predicted: true } // future
        }
        if (doneChain.has(id)) return { status: "completed", predicted: false } // 结构节点在 done 段
        if (futureFwd.has(id) && !doneChain.has(id)) return { status: undefined, predicted: true } // 结构节点在 future 段
        return { status: undefined, predicted: false }
      }
      return { status: statusOf(id), predicted: false }
    }

    const outNodes: Node[] = built.nodes.map((n) => {
      const v = nodeVisual(n.id)
      const pn = predicting ? predictById.get(n.id) : undefined
      // 预计办理人：仅在该节点**无实际办理记录**时补充展示（done 节点已有 HandledInfo，不重复）
      const hasHandled = (nodeInfo?.[n.id]?.assignees.length ?? 0) > 0
      const pNames = pn && !hasHandled && pn.assignees.length ? pn.assignees : undefined
      // 回放中：仅已揭示（walked/active）节点显办理信息
      const showInfo = replaying ? walked?.has(n.id) || n.id === activeStep : true
      return {
        ...n,
        data: {
          ...n.data,
          status: v.status,
          info: showInfo ? nodeInfo?.[n.id] : undefined,
          predicted: v.predicted,
          predictNames: pNames,
          // 预测态：审批节点可驳回标记 + 并签模式 + 并行分组（供卡片标注）
          canReject: pn && pn.canReject && pn.rejectTo ? true : false,
          rejectToName: pn?.rejectTo?.name,
          multiMode: pn?.multiMode ?? undefined,
          parallelGroup: pn?.parallelGroup ?? undefined,
        },
      }
    })

    // 边着色：回放 > 预测完整链路（done绿/进current主题色 + future蓝虚线）> 常态走过路径 > 灰
    const edgeDeco = (src: string, tgt: string): { style: React.CSSProperties; className?: string } => {
      if (replaying) {
        if (replay > 0 && src === replaySeq[replay - 1]) return { style: { stroke: "var(--primary)", strokeWidth: 2.5 }, className: "wf-dt-edge-flow" }
        if (walked?.has(src)) return { style: { stroke: "#10b981", strokeWidth: 2 } }
        return { style: { stroke: "var(--border)", strokeWidth: 1.5 } }
      }
      if (predicting) {
        if (doneChain.has(src) && doneChain.has(tgt)) {
          const stroke = currentPSet.has(tgt) ? "var(--primary)" : "#10b981"
          return { style: { stroke, strokeWidth: 2.5, strokeDasharray: "6 4" }, className: "wf-dt-edge-loop" }
        }
        const sFut = futureFwd.has(src) && !doneChain.has(src)
        const tFut = futureFwd.has(tgt) && !doneChain.has(tgt)
        if ((doneChain.has(src) || sFut) && tFut) return { style: { stroke: "#60a5fa", strokeWidth: 2, strokeDasharray: "6 4" } }
        return { style: { stroke: "var(--border)", strokeWidth: 1.5 } }
      }
      if (walkedNodes.has(src) && walkedNodes.has(tgt)) {
        const stroke = activeNodeSet.has(tgt) ? "var(--primary)" : "#10b981"
        return { style: { stroke, strokeWidth: 2.5, strokeDasharray: "6 4" }, className: "wf-dt-edge-loop" }
      }
      return { style: { stroke: "var(--border)", strokeWidth: 1.5 } }
    }
    const outEdges: Edge[] = built.edges.map((e) => {
      const { style, className } = edgeDeco(e.source, e.target)
      return { id: e.id, source: e.source, target: e.target, type: "smoothstep", style, className }
    })
    return { nodes: outNodes, edges: outEdges, empty: false }
  }, [designerJson, highlight, nodeInfo, replay, replaySeq, predict, predictRevealed])

  if (empty) {
    return (
      <div className="flex h-105 flex-col items-center justify-center gap-2 text-muted-foreground">
        <GitBranch className="size-8 opacity-30" />
        <span className="text-sm">暂无流程图</span>
      </div>
    )
  }

  const replaying = replay !== null
  const predicting = predictPlay !== null

  const legend = (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border-2 border-emerald-500" /> 已完成
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 animate-pulse rounded-sm border-2 border-primary" /> 进行中
      </span>
      {predict && (
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border-2 border-dashed border-blue-400" /> 预测后续
        </span>
      )}
    </div>
  )

  return (
    <div className="wf-dt-track relative h-105 w-full rounded-md border bg-background">
      <style>{TRACK_CSS}</style>

      {/* 顶部工具条：回放 / 预测运行（手动触发，默认静态高亮） */}
      {(canReplay || onRequestPredict || predict) && (
        <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5">
          {canReplay && (
            <Button
              size="sm"
              variant={replaying ? "default" : "outline"}
              className="h-7 gap-1 bg-card/90 text-xs shadow-sm backdrop-blur"
              onClick={() => (replaying ? setReplay(null) : startReplay())}
              title="按审批时间序回放"
            >
              {replaying ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
              {replaying ? "停止" : "回放"}
            </Button>
          )}
          {predict ? (
            <Button
              size="sm"
              variant={predicting ? "default" : "outline"}
              className="h-7 gap-1 bg-card/90 text-xs shadow-sm backdrop-blur"
              onClick={() => (predicting ? setPredictPlay(null) : startPredictPlay())}
              title="沿预测路径逐节点点亮"
            >
              {predicting ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
              {predicting ? "停止" : "播放预测"}
            </Button>
          ) : (
            onRequestPredict && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 bg-card/90 text-xs shadow-sm backdrop-blur"
                disabled={predictLoading}
                onClick={onRequestPredict}
                title="演算后续将经过的节点与预计办理人"
              >
                {predictLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                预测运行
              </Button>
            )
          )}
        </div>
      )}

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
