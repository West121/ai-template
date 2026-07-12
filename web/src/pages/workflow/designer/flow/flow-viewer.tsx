/**
 * 只读流程图渲染器 `FlowViewer`（替换 bpmn-js NavigatedViewer 的运行时跟踪图）。
 *
 * 基于 react-flow 设计器画布层的**只读变体**：复用同一套 nodeTypes / edgeTypes / 节点组件，
 * 渲染归一化 `ProcessModel` + 运行时 `highlight`（completed / active）。
 *
 * 流程图预览增强（2026-07-12）——**手动触发、专业克制**：
 *  ① 节点办理信息（nodeInfo）：ViewportPortal 叠加层——右上角状态角标（未到达灰/进行中蓝/已通过绿✓/
 *     驳回红/加签紫）+ 已办节点缩略行（办理人·时间）+ 悬浮/点击弹卡（姓名/状态/时间/意见摘要）。
 *     叠加层不改节点组件、不进序列化（与 highlight 同为瞬态）。
 *  ② 审批过程回放（replaySteps）：「▶ 回放」按时间序依次点亮节点 + 走过的边流光扫过（单次，不循环）；
 *     不放=静态高亮（现状）。reduce-motion 直接终态。
 *  ③ 流程预测运行（predict）：后续节点/边蓝色虚线 + 预计办理人；「▶ 播放预测」逐节点点亮（克制单次）。
 *
 * 暗色态：随 app-store themeMode 走 ReactFlow colorMode。禁 any；类型导入一律 import type。
 */
import { useEffect, useMemo, useState } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useNodes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { CheckCircle2, Circle, Clock, GitBranch, Loader2, Play, Sparkles, Square, UserPlus, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { Button } from "@/components/ui/button"
import type { WfHighlight } from "@/types/workflow"
import { edgeTypes } from "./edges"
import { nodeTypes } from "./nodes"
import type { NodeHighlightState } from "./nodes/node-chrome"
import type { ProcessModel } from "./model"
import { fromProcessModel, type WfRfEdge, type WfRfNode } from "./serialize"
import { predictedEdgeIds, replayFlowEdgeId, type NodeRuntimeInfo, type NodeRuntimeStatus } from "./runtime-info"

/** 进行中脉冲 + 预测虚线呼吸 + 回放边流光（单次扫过，不循环）。 */
const VIEWER_CSS = `
@keyframes wf-hl-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--primary); }
  50% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 35%, transparent); }
}
.wf-flow-viewer .wf-hl-active { animation: wf-hl-pulse 1.6s ease-in-out infinite; }
@keyframes wf-predict-breathe { 0%,100% { outline-color: #60a5fa; } 50% { outline-color: color-mix(in srgb, #60a5fa 40%, transparent); } }
.wf-flow-viewer .wf-hl-predicted { animation: wf-predict-breathe 2s ease-in-out infinite; }
@keyframes wf-edge-flow-dash { to { stroke-dashoffset: -24; } }
.wf-flow-viewer .wf-edge-flow { stroke-dasharray: 8 4; animation: wf-edge-flow-dash 0.6s linear 2; }
@media (prefers-reduced-motion: reduce) {
  .wf-flow-viewer .wf-hl-active,
  .wf-flow-viewer .wf-hl-predicted,
  .wf-flow-viewer .wf-edge-flow { animation: none; }
}
`

/** ③ 预测链路节点（后端 /predict 完整链路：done+current+future） */
export interface FlowPredictNode {
  nodeId: string
  nodeName?: string
  /** done=已完成 / current=当前活动 / future=后续（已结束实例全 done） */
  status: "done" | "current" | "future"
  /** 预计办理人名 */
  assignees: string[]
  /** 审批节点可驳回（缺省 true） */
  canReject?: boolean
  /** 驳回回退目标 */
  rejectTo?: { nodeId: string; name: string } | null
  /** 并签模式（非审批 null）：ALL 会签/ANY 或签/SEQUENCE 顺序/VOTE 投票 */
  multiMode?: "ALL" | "ANY" | "SEQUENCE" | "VOTE" | (string & {}) | null
  /** 并行网关分组 id（同组并排） */
  parallelGroup?: string | null
}

/** ③ 预测数据（父层拉取 /predict 归一）：完整链路（从头到尾按 status 着色） */
export interface FlowPredict {
  /** 完整链路（done→current→future，按顺序） */
  nodes: FlowPredictNode[]
  /** 演算说明（如"流程已结束，展示完整链路"） */
  note?: string
}

export interface FlowViewerProps {
  /** 归一化流程模型（由 .bpmn 经 /api/wf/models/import 转出，或直接来自 GRAPH 定义） */
  model: ProcessModel
  /** 运行时高亮：completed=已完成、active=当前节点；id 与节点/边 id 对齐 */
  highlight?: WfHighlight
  /** ① 节点办理信息 nodeId→info（缺省则不显叠加层） */
  nodeInfo?: Record<string, NodeRuntimeInfo>
  /** ② 回放：时间序 nodeId 序列（≥2 才显「回放」） */
  replaySteps?: string[]
  /** ③ 预测数据（已拉取）；null/缺省=未拉取 */
  predict?: FlowPredict | null
  /** ③ 触发拉取预测（有则显「预测运行」按钮） */
  onRequestPredict?: () => void
  predictLoading?: boolean
  /** 画布容器高度 class，默认 h-105（与旧 bpmn 跟踪图一致） */
  heightClass?: string
  className?: string
}

const REPLAY_STEP_MS = 750
const PREDICT_STEP_MS = 650
const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/* ---------------- ① 节点办理信息叠加层（ViewportPortal，随缩放平移贴节点） ---------------- */

const STATUS_META: Record<NodeRuntimeStatus, { label: string; cls: string; dot: string }> = {
  notReached: { label: "未到达", cls: "border-muted-foreground/30 bg-background text-muted-foreground", dot: "bg-muted-foreground/30" },
  active: { label: "进行中", cls: "border-primary bg-primary text-primary-foreground", dot: "bg-primary" },
  completed: { label: "已通过", cls: "border-emerald-500 bg-emerald-500 text-white", dot: "bg-emerald-500" },
  rejected: { label: "驳回", cls: "border-rose-500 bg-rose-500 text-white", dot: "bg-rose-500" },
  addSign: { label: "加签", cls: "border-violet-500 bg-violet-500 text-white", dot: "bg-violet-500" },
}

function StatusIcon({ status }: { status: NodeRuntimeStatus }) {
  if (status === "completed") return <CheckCircle2 className="size-3" />
  if (status === "rejected") return <XCircle className="size-3" />
  if (status === "addSign") return <UserPlus className="size-3" />
  if (status === "active") return <Clock className="size-3" />
  return <Circle className="size-3" />
}

function shortTime(t?: string): string {
  if (!t) return ""
  // "2026-07-12 14:30:00" / ISO → "07-12 14:30"
  const s = t.replace("T", " ")
  return s.length >= 16 ? s.slice(5, 16) : s
}

/** 节点尺寸兜底（measured 缺失首帧） */
function nodeSize(n: WfRfNode): { w: number; h: number } {
  const m = n.measured
  if (m?.width && m?.height) return { w: m.width, h: m.height }
  const t = n.type
  if (t === "exclusiveGateway" || t === "parallelGateway" || t === "inclusiveGateway") return { w: 48, h: 48 }
  if (t === "startEvent" || t === "endEvent" || t === "timerCatch" || t === "timerBoundary") return { w: 44, h: 44 }
  return { w: 208, h: 64 }
}

function RuntimeOverlay({
  infoMap,
  predictAssignees,
  predictedSet,
}: {
  infoMap: Record<string, NodeRuntimeInfo>
  predictAssignees: Record<string, string[]>
  predictedSet: Set<string>
}) {
  const nodes = useNodes<WfRfNode>()
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <ViewportPortal>
      {nodes.map((n) => {
        const info = infoMap[n.id]
        const predicted = predictedSet.has(n.id)
        if (!info && !predicted) return null
        const { w, h } = nodeSize(n)
        const x = n.position.x
        const y = n.position.y
        const meta = info ? STATUS_META[info.status] : STATUS_META.notReached
        const handled = !!info && info.assignees.length > 0
        const open = openId === n.id
        const predNames = predictAssignees[n.id] ?? []
        // 预测节点（无历史办理信息）→ 蓝色预测角标；否则显运行时状态角标
        const showPredictBadge = predicted && !info

        return (
          <div key={`ov-${n.id}`}>
            {/* 右上角状态角标（预测节点独立蓝标） */}
            <div
              style={{ position: "absolute", left: x + w, top: y, zIndex: 6 }}
              className="pointer-events-auto -translate-x-1/2 -translate-y-1/2"
              onMouseEnter={() => setOpenId(n.id)}
              onMouseLeave={() => setOpenId((o) => (o === n.id ? null : o))}
              onClick={() => setOpenId((o) => (o === n.id ? null : n.id))}
            >
              {showPredictBadge ? (
                <span className="flex size-4 items-center justify-center rounded-full border border-blue-400 bg-blue-400 text-white shadow-sm">
                  <Sparkles className="size-2.5" />
                </span>
              ) : (
                info && (
                  <span className={cn("flex size-4 items-center justify-center rounded-full border shadow-sm", meta.cls, info.status === "active" && "animate-pulse")}>
                    <StatusIcon status={info.status} />
                  </span>
                )
              )}
            </div>

            {/* 已办缩略行（办理人·时间；点击/悬浮弹卡） */}
            {handled && info && (
              <div
                style={{ position: "absolute", left: x, top: y + h + 2, maxWidth: w, zIndex: 5 }}
                className="pointer-events-auto flex cursor-default items-center gap-1 truncate rounded border bg-card/95 px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur"
                onMouseEnter={() => setOpenId(n.id)}
                onMouseLeave={() => setOpenId((o) => (o === n.id ? null : o))}
                onClick={() => setOpenId((o) => (o === n.id ? null : n.id))}
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
                <span className="min-w-0 truncate">
                  {info.assignees[0].name}
                  {info.assignees.length > 1 && ` +${info.assignees.length - 1}`}
                </span>
                {info.time && <span className="shrink-0 opacity-70">{shortTime(info.time)}</span>}
              </div>
            )}

            {/* 预测节点预计办理人小标（与已办缩略行互斥，避免同位重叠） */}
            {predicted && !handled && predNames.length > 0 && (
              <div
                style={{ position: "absolute", left: x, top: y + h + 2, maxWidth: w, zIndex: 5 }}
                className="pointer-events-none flex items-center gap-1 truncate rounded border border-blue-400/40 bg-blue-50/90 px-1.5 py-0.5 text-[10px] text-blue-600 shadow-sm dark:bg-blue-950/40 dark:text-blue-300"
              >
                <Sparkles className="size-2.5 shrink-0" />
                <span className="min-w-0 truncate">预计 {predNames.join("、")}</span>
              </div>
            )}

            {/* 悬浮/点击弹卡（办理详情） */}
            {open && info && (
              <div
                style={{ position: "absolute", left: x + w / 2, top: y + h + (handled ? 20 : 8), zIndex: 30 }}
                className="pointer-events-auto w-56 -translate-x-1/2 rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-lg"
                onMouseEnter={() => setOpenId(n.id)}
                onMouseLeave={() => setOpenId(null)}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className={cn("flex size-4 items-center justify-center rounded-full border", meta.cls)}>
                    <StatusIcon status={info.status} />
                  </span>
                  <span className="text-xs font-semibold">{n.data.name || "节点"}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{meta.label}</span>
                </div>
                {info.assignees.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">{info.status === "active" ? "等待办理中" : "无办理记录"}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {info.assignees.map((a, i) => (
                      <li key={i} className="border-t pt-1.5 first:border-t-0 first:pt-0">
                        <div className="flex items-center gap-1.5">
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-medium text-primary">
                            {a.name.slice(0, 1)}
                          </span>
                          <span className="text-[11px] font-medium">{a.name}</span>
                          {a.time && <span className="ml-auto text-[10px] text-muted-foreground">{shortTime(a.time)}</span>}
                        </div>
                        {a.opinion && <p className="mt-0.5 break-words pl-6.5 text-[10px] text-muted-foreground">{a.opinion}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )
      })}
    </ViewportPortal>
  )
}

/* ---------------- 主体 ---------------- */

function FlowViewerInner({ model, highlight, nodeInfo, replaySteps, predict, onRequestPredict, predictLoading, heightClass = "h-105", className }: FlowViewerProps) {
  const dark = isDarkMode(useAppStore((s) => s.themeMode))

  // 回放：null=不放；数字=当前步索引（0..steps-1）
  const [replay, setReplay] = useState<number | null>(null)
  // 预测播放：null=静态（全量虚线）或未播放；数字=已揭示到第几个预测节点
  const [predictPlay, setPredictPlay] = useState<number | null>(null)

  const steps = useMemo(() => replaySteps ?? [], [replaySteps])
  const canReplay = steps.length >= 2

  // 预测链路归一：FlowViewer（BPMN/GRAPH，次要）只叠加 future 节点为蓝虚线；done/current 由 highlight 驱动
  const predictFutureIds = useMemo(() => predict?.nodes.filter((n) => n.status === "future").map((n) => n.nodeId) ?? [], [predict])
  const predictAssignees = useMemo(
    () => (predict ? Object.fromEntries(predict.nodes.map((n) => [n.nodeId, n.assignees])) : {}),
    [predict],
  )

  // 回放定时推进（reduce-motion 直接终态）
  useEffect(() => {
    if (replay === null) return
    if (replay >= steps.length) {
      setReplay(null)
      return
    }
    if (prefersReducedMotion()) {
      setReplay(null)
      return
    }
    const t = window.setTimeout(() => setReplay((r) => (r === null ? null : r + 1)), REPLAY_STEP_MS)
    return () => window.clearTimeout(t)
  }, [replay, steps.length])

  // 预测播放定时推进
  useEffect(() => {
    if (predictPlay === null || !predict) return
    if (predictPlay >= predictFutureIds.length) {
      setPredictPlay(null)
      return
    }
    if (prefersReducedMotion()) {
      setPredictPlay(null)
      return
    }
    const t = window.setTimeout(() => setPredictPlay((p) => (p === null ? null : p + 1)), PREDICT_STEP_MS)
    return () => window.clearTimeout(t)
  }, [predictPlay, predict])

  const startReplay = () => {
    setPredictPlay(null)
    if (!canReplay) return
    if (prefersReducedMotion()) return // 静态已是终态
    setReplay(0)
  }
  const startPredictPlay = () => {
    setReplay(null)
    if (!predict || predictFutureIds.length === 0) return
    if (prefersReducedMotion()) return
    setPredictPlay(0)
  }

  // 预测可见（future）节点（静态=全量虚线；播放中=逐个揭示）
  const predictedVisible = useMemo(() => {
    if (!predict) return [] as string[]
    const count = predictPlay === null ? predictFutureIds.length : Math.min(predictPlay + 1, predictFutureIds.length)
    return predictFutureIds.slice(0, count)
  }, [predict, predictPlay, predictFutureIds])
  const predictedSet = useMemo(() => new Set(predictedVisible), [predictedVisible])

  const { nodes, edges, infoMap } = useMemo(() => {
    const base = fromProcessModel(model)
    const staticCompleted = new Set(highlight?.completed ?? [])
    const staticActive = new Set(highlight?.active ?? [])

    // 回放态：只揭示已走过的节点/边（steps[0..replay]）
    const replaying = replay !== null
    const walked = replaying ? new Set(steps.slice(0, replay)) : null
    const activeStep = replaying && replay < steps.length ? steps[replay] : null
    const flowEdge = replaying ? replayFlowEdgeId(base.edges, steps, replay ?? 0) : null

    const predEdgeSet = predict ? predictedEdgeIds(base.edges, predictedVisible, [...staticActive]) : new Set<string>()

    const nodeState = (id: string): NodeHighlightState | undefined => {
      if (replaying) {
        if (id === activeStep) return "active"
        if (walked?.has(id)) return "completed"
        return undefined
      }
      if (staticActive.has(id)) return "active"
      if (staticCompleted.has(id)) return "completed"
      if (predictedSet.has(id)) return "predicted"
      return undefined
    }

    const nodes: WfRfNode[] = base.nodes.map((n) => {
      const state = nodeState(n.id)
      return state ? { ...n, selected: false, data: { ...n.data, highlight: state } } : { ...n, selected: false }
    })
    const edges: WfRfEdge[] = base.edges.map((e) => {
      if (replaying) {
        if (e.id === flowEdge) return { ...e, data: { ...e.data, flow: true } }
        if (walked?.has(e.source) && walked?.has(e.target)) return { ...e, data: { ...e.data, highlight: "completed" } }
        return { ...e, data: { ...e.data, highlight: undefined, flow: false } }
      }
      if (staticActive.has(e.id)) return { ...e, data: { ...e.data, highlight: "active" } }
      if (staticCompleted.has(e.id)) return { ...e, data: { ...e.data, highlight: "completed" } }
      if (predEdgeSet.has(e.id)) return { ...e, data: { ...e.data, highlight: "predicted" } }
      return e
    })

    // ① 叠加层信息：只对"有状态"的节点（已办/在办）显角标+缩略行，未到达节点不渲染（清爽）。
    // 回放中仅揭示已走过/当前步节点。
    let infoMap: Record<string, NodeRuntimeInfo> = {}
    if (nodeInfo) {
      if (replaying) {
        for (const n of base.nodes) {
          if (n.id === activeStep) infoMap[n.id] = { ...(nodeInfo[n.id] ?? { status: "active", assignees: [] }), status: "active" }
          else if (walked?.has(n.id)) infoMap[n.id] = nodeInfo[n.id] ?? { status: "completed", assignees: [] }
        }
      } else {
        infoMap = { ...nodeInfo }
      }
    }
    return { nodes, edges, infoMap }
  }, [model, highlight, nodeInfo, replay, steps, predict, predictedVisible, predictedSet])

  const showOverlay = !!nodeInfo || predictedSet.size > 0
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
      {(predict || predictedSet.size > 0) && (
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border-2 border-dashed border-blue-400" /> 预测
        </span>
      )}
    </div>
  )

  return (
    <div className={cn("wf-flow-viewer relative w-full rounded-md border bg-background", heightClass, className)}>
      <style>{VIEWER_CSS}</style>

      {/* 顶部控制条：回放 / 预测运行（手动触发，默认静态） */}
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

      <ReactFlow<WfRfNode, WfRfEdge>
        colorMode={dark ? "dark" : "light"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        minZoom={0.3}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} />
        {showOverlay && <RuntimeOverlay infoMap={infoMap} predictAssignees={predictAssignees} predictedSet={predictedSet} />}
      </ReactFlow>
      {legend}
    </div>
  )
}

/** 空态：无节点时的占位（如导入失败或空模型） */
function EmptyState({ heightClass = "h-105" }: { heightClass?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 text-muted-foreground", heightClass)}>
      <GitBranch className="size-8 opacity-30" />
      <span className="text-sm">暂无流程图</span>
    </div>
  )
}

export function FlowViewer(props: FlowViewerProps) {
  if (!props.model || props.model.nodes.length === 0) {
    return <EmptyState heightClass={props.heightClass} />
  }
  return (
    <ReactFlowProvider>
      <FlowViewerInner {...props} />
    </ReactFlowProvider>
  )
}
