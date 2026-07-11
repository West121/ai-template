/**
 * 编排设计器主体：palette + react-flow 画布 + 配置面板（复用现有设计器交互模式：拖拽/点击新增、
 * 连线即时校验、dagre 整理、ErrorBoundary 包面板；独立于审批流设计器）。
 *
 * 受控于 designer-page（顶部条持有名称/保存/发布/测试运行）；本组件经 ref 暴露
 * getModel / validate / autoLayout / applyExecStatus（测试运行逐节点回放）。
 */
import { useCallback, useImperativeHandle, useMemo, useState, type DragEvent, type Ref } from "react"
import Dagre from "@dagrejs/dagre"
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  getSmoothStepPath,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useInternalNode,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeProps,
  type EdgeTypes,
  type InternalNode,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { ErrorBoundary } from "@/components/error-boundary"
import { summarizeCondition } from "@/pages/workflow/designer/flow/summary"
import type { OrchCredential, OrchFlow } from "../mock"
import { defaultConfig, validateOrchModel, type OrchIssue, type OrchModel, type OrchNodeType } from "./model"
import { NODE_META, ORCH_DND_MIME, orchNodeTypes, PALETTE_GROUPS } from "./nodes"
import { OrchEdgePanel, OrchNodePanel, type UpstreamNode } from "./panel"
import {
  fromOrchModel,
  ORCH_EDGE_TYPE,
  toOrchModel,
  type OrchRfEdge,
  type OrchRfNode,
} from "./serialize"

let idSeq = 0
const genId = (prefix: string) => `${prefix}_${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

/* ============================ 边组件（条件摘要标签 + 浮动边界锚点） ============================ */

/** 节点包围盒（中心 + 半宽半高）；首帧未测量时回退默认尺寸，绝不取 0 */
function nodeBox(n: InternalNode): { cx: number; cy: number; hw: number; hh: number } {
  const nn = n as InternalNode & { width?: number; height?: number }
  const w = n.measured.width || nn.width || 208
  const h = n.measured.height || nn.height || 60
  const x = n.internals.positionAbsolute.x
  const y = n.internals.positionAbsolute.y
  return { cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2 }
}

/**
 * 中心连线 × 包围盒边界交点 + 所在边朝向：边端点恰落在节点边界（竖排=底出顶入、横排=左右出入），
 * 绝不悬空、绝不穿节点体（与审批流设计器 sequence-flow-edge 同一做法）。
 */
function boundaryPoint(cx: number, cy: number, hw: number, hh: number, towardX: number, towardY: number): { x: number; y: number; pos: Position } {
  const dx = towardX - cx
  const dy = towardY - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy, pos: Position.Top }
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY
  const scale = Math.min(scaleX, scaleY)
  const x = cx + dx * scale
  const y = cy + dy * scale
  const pos = scaleX < scaleY ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top
  return { x, y, pos }
}

function OrchEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data }: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  // 浮动锚点：无视边挂靠的具体 Handle（序列化不存 Handle），按两节点实时几何求边界交点
  let sx = sourceX
  let sy = sourceY
  let sp = sourcePosition ?? Position.Bottom
  let tx = targetX
  let ty = targetY
  let tp = targetPosition ?? Position.Top
  if (sourceNode && targetNode) {
    const S = nodeBox(sourceNode)
    const T = nodeBox(targetNode)
    const a = boundaryPoint(S.cx, S.cy, S.hw, S.hh, T.cx, T.cy)
    const b = boundaryPoint(T.cx, T.cy, T.hw, T.hh, S.cx, S.cy)
    sx = a.x
    sy = a.y
    sp = a.pos
    tx = b.x
    ty = b.y
    tp = b.pos
  }

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sp,
    targetX: tx,
    targetY: ty,
    targetPosition: tp,
    borderRadius: 8,
  })
  const d = data as
    | { condition?: never; expression?: string; isDefault?: boolean; loopBody?: boolean; errorBranch?: boolean }
    | undefined
  // 标签优先级：循环体/失败分支（图契约标记）> 默认 > 条件摘要
  const label = d?.loopBody
    ? "循环体"
    : d?.errorBranch
      ? "失败"
      : d?.isDefault
        ? "默认"
        : d?.expression?.trim() || summarizeCondition(d?.condition, false)
  const labelTone = d?.errorBranch
    ? "border-rose-500/40 text-rose-600 dark:text-rose-400"
    : "text-amber-600 dark:text-amber-400"
  return (
    <>
      <path id={id} d={path} fill="none" markerEnd={markerEnd} className="react-flow__edge-path" style={{ stroke: selected ? "var(--primary)" : undefined, strokeWidth: selected ? 2.5 : 1.5 }} />
      {label && (
        <foreignObject x={labelX - 60} y={labelY - 10} width={120} height={20} className="pointer-events-none overflow-visible">
          <div className="flex justify-center">
            <span className={cn("max-w-28 truncate rounded border bg-background px-1.5 text-[10px] leading-4", labelTone)}>
              {label}
            </span>
          </div>
        </foreignObject>
      )}
    </>
  )
}

const orchEdgeTypes: EdgeTypes = { [ORCH_EDGE_TYPE]: OrchEdge }

/* ============================ 布局 ============================ */

function layoutNodes(nodes: OrchRfNode[], edges: OrchRfEdge[]): OrchRfNode[] {
  const g = new Dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 70 })
  for (const n of nodes) g.setNode(n.id, { width: 208, height: 60 })
  for (const e of edges) g.setEdge(e.source, e.target)
  Dagre.layout(g)
  return nodes.map((n) => {
    const pos = g.node(n.id)
    return pos ? { ...n, position: { x: pos.x - 104, y: pos.y - 30 } } : n
  })
}

/* ============================ 连线校验 ============================ */

function checkConnection(source: OrchRfNode | undefined, target: OrchRfNode | undefined, edges: OrchRfEdge[], c: Connection): string | null {
  if (!source || !target) return "节点不存在"
  if (c.source === c.target) return "不能连接自身"
  if (target.type === "trigger") return "触发节点不能有入边"
  if (source.type === "end") return "结束节点不能有出边"
  if (edges.some((e) => e.source === c.source && e.target === c.target)) return "已存在同向连线"
  return null
}

/* ============================ 主体 ============================ */

export interface OrchDesignerHandle {
  getModel: () => OrchModel
  validate: () => OrchIssue[]
  autoLayout: () => void
  /** 测试运行回放：把 exec 节点状态映射到画布（null 清除） */
  applyExecStatus: (statusById: Record<string, "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED"> | null) => void
}

export interface OrchDesignerProps {
  initialModel: OrchModel
  meta: { key: string; name: string }
  credentials: OrchCredential[]
  /** 其它编排（subFlow 目标） */
  flows: OrchFlow[]
  onDirty?: () => void
  ref?: Ref<OrchDesignerHandle>
}

type Selection = { kind: "none" } | { kind: "node"; id: string } | { kind: "edge"; id: string }

function OrchDesignerInner({ initialModel, meta, credentials, flows, onDirty, ref }: OrchDesignerProps) {
  const dark = isDarkMode(useAppStore((s) => s.themeMode))
  const [seed] = useState(() => fromOrchModel(initialModel))
  const [nodes, setNodes, onNodesChange] = useNodesState<OrchRfNode>(seed.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<OrchRfEdge>(seed.edges)
  const [selection, setSelection] = useState<Selection>({ kind: "none" })
  const [issues, setIssues] = useState<OrchIssue[] | null>(null)
  const { screenToFlowPosition, fitView } = useReactFlow<OrchRfNode, OrchRfEdge>()

  const markDirty = useCallback(() => onDirty?.(), [onDirty])

  /* ---- 增删 ---- */
  const addNode = useCallback(
    (type: OrchNodeType, position: { x: number; y: number }) => {
      if (type === "trigger" && nodes.some((n) => n.type === "trigger")) {
        toast.warning("每条编排只能有一个触发节点")
        return
      }
      const id = genId(type)
      setNodes((ns) => [...ns, { id, type, position, data: { name: NODE_META[type].label, config: defaultConfig(type) } }])
      setSelection({ kind: "node", id })
      markDirty()
    },
    [nodes, setNodes, markDirty],
  )

  const removeSelected = useCallback(() => {
    if (selection.kind === "node") {
      setNodes((ns) => ns.filter((n) => n.id !== selection.id))
      setEdges((es) => es.filter((e) => e.source !== selection.id && e.target !== selection.id))
      setSelection({ kind: "none" })
      markDirty()
    } else if (selection.kind === "edge") {
      setEdges((es) => es.filter((e) => e.id !== selection.id))
      setSelection({ kind: "none" })
      markDirty()
    }
  }, [selection, setNodes, setEdges, markDirty])

  /* ---- 连线 ---- */
  const onConnect = useCallback(
    (c: Connection) => {
      const err = checkConnection(
        nodes.find((n) => n.id === c.source),
        nodes.find((n) => n.id === c.target),
        edges,
        c,
      )
      if (err) {
        toast.error("无法连接", { description: err })
        return
      }
      setEdges((es) => addEdge<OrchRfEdge>({ ...c, id: genId("e"), type: ORCH_EDGE_TYPE, data: {} }, es))
      markDirty()
    },
    [nodes, edges, setEdges, markDirty],
  )

  const isValidConnection = useCallback(
    (c: Connection | OrchRfEdge) =>
      checkConnection(
        nodes.find((n) => n.id === c.source),
        nodes.find((n) => n.id === c.target),
        edges,
        c as Connection,
      ) == null,
    [nodes, edges],
  )

  /* ---- 拖拽落点 ---- */
  const onDrop = useCallback(
    (e: DragEvent) => {
      const type = e.dataTransfer.getData(ORCH_DND_MIME) as OrchNodeType
      if (!type) return
      e.preventDefault()
      addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    },
    [addNode, screenToFlowPosition],
  )

  /* ---- 模型 / 校验 / 布局 ---- */
  const buildModel = useCallback(() => toOrchModel(nodes, edges, meta), [nodes, edges, meta])

  const runValidate = useCallback(() => {
    const found = validateOrchModel(buildModel())
    setIssues(found)
    return found
  }, [buildModel])

  const autoLayout = useCallback(() => {
    setNodes((ns) => layoutNodes(ns, edges))
    requestAnimationFrame(() => void fitView({ padding: 0.25, maxZoom: 1.2, duration: 300 }))
    markDirty()
  }, [edges, setNodes, fitView, markDirty])

  const applyExecStatus = useCallback(
    (statusById: Record<string, "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED"> | null) => {
      setNodes((ns) =>
        ns.map((n) => ({ ...n, data: { ...n.data, execStatus: statusById?.[n.id] } })),
      )
    },
    [setNodes],
  )

  // validate 经 ref 调用：跑校验 + 在画布内高亮与摘要条展示
  useImperativeHandle(ref, () => ({ getModel: buildModel, validate: runValidate, autoLayout, applyExecStatus }), [buildModel, runValidate, autoLayout, applyExecStatus])

  /* ---- 校验高亮注入（瞬态） ---- */
  const errorIds = useMemo(() => {
    const err = new Set<string>()
    const warn = new Set<string>()
    for (const it of issues ?? []) {
      if (it.nodeId) (it.level === "error" ? err : warn).add(it.nodeId)
    }
    return { err, warn }
  }, [issues])

  const displayNodes = useMemo(
    () =>
      nodes.map((n) =>
        errorIds.err.has(n.id)
          ? { ...n, data: { ...n.data, validation: "error" as const } }
          : errorIds.warn.has(n.id)
            ? { ...n, data: { ...n.data, validation: "warning" as const } }
            : n,
      ),
    [nodes, errorIds],
  )

  /* ---- 选中态派生 ---- */
  const selectedNode = selection.kind === "node" ? nodes.find((n) => n.id === selection.id) : undefined
  const selectedEdge = selection.kind === "edge" ? edges.find((e) => e.id === selection.id) : undefined

  /** 上游节点集（反向 BFS），变量选择器用 */
  const upstream = useMemo<UpstreamNode[]>(() => {
    const targetId = selection.kind === "node" ? selection.id : selection.kind === "edge" ? selectedEdge?.source : undefined
    if (!targetId) return []
    const rev = new Map<string, string[]>()
    for (const e of edges) rev.set(e.target, [...(rev.get(e.target) ?? []), e.source])
    const seen = new Set<string>()
    const queue = [...(rev.get(targetId) ?? []), ...(selection.kind === "edge" && selectedEdge ? [selectedEdge.source] : [])]
    while (queue.length) {
      const id = queue.shift()!
      if (seen.has(id)) continue
      seen.add(id)
      queue.push(...(rev.get(id) ?? []))
    }
    return nodes.filter((n) => seen.has(n.id) && n.type !== "trigger").map((n) => ({ id: n.id, name: n.data.name }))
  }, [selection, selectedEdge, nodes, edges])

  const updateNode = useCallback(
    (id: string, patch: Partial<OrchRfNode["data"]>) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
      markDirty()
    },
    [setNodes, markDirty],
  )

  const updateEdge = useCallback(
    (id: string, patch: Partial<NonNullable<OrchRfEdge["data"]>>) => {
      setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)))
      markDirty()
    },
    [setEdges, markDirty],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 校验结果条 */}
      {issues !== null && issues.length > 0 && (
        <div className="shrink-0 border-b bg-card px-3 py-1.5 text-xs">
          <span className="font-medium text-muted-foreground">
            {issues.filter((i) => i.level === "error").length} 个错误 · {issues.filter((i) => i.level === "warning").length} 个提示：
          </span>
          <span className="ml-1 space-x-2">
            {issues.slice(0, 3).map((it, i) => (
              <span key={i} className={it.level === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}>
                {it.message}
              </span>
            ))}
            {issues.length > 3 && <span className="text-muted-foreground">等 {issues.length} 项</span>}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* palette */}
        <aside className="w-44 shrink-0 space-y-3 overflow-y-auto border-r bg-muted/20 p-2.5">
          {PALETTE_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">{group.label}</div>
              <div className="space-y-1">
                {group.types.map((t) => {
                  const m = NODE_META[t]
                  return (
                    <button
                      key={t}
                      type="button"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData(ORCH_DND_MIME, t)}
                      onClick={() => addNode(t, screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2.5 }))}
                      className="flex w-full cursor-grab items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-accent"
                      title={m.description}
                    >
                      <span className={cn("flex size-5 shrink-0 items-center justify-center rounded text-white", m.headerClass)}>
                        <m.icon className="size-3" />
                      </span>
                      <span className="truncate">{m.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </aside>

        {/* 画布 */}
        <div className="min-w-0 flex-1" onDragOver={(e) => { if (e.dataTransfer.types.includes(ORCH_DND_MIME)) e.preventDefault() }} onDrop={onDrop}>
          <ReactFlow<OrchRfNode, OrchRfEdge>
            colorMode={dark ? "dark" : "light"}
            nodes={displayNodes}
            edges={edges}
            nodeTypes={orchNodeTypes}
            edgeTypes={orchEdgeTypes}
            onNodesChange={(changes) => {
              onNodesChange(changes)
              if (changes.some((c) => c.type === "position" || c.type === "remove")) markDirty()
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes)
              if (changes.some((c) => c.type === "remove")) markDirty()
            }}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, n) => setSelection({ kind: "node", id: n.id })}
            onEdgeClick={(_, e) => setSelection({ kind: "edge", id: e.id })}
            onPaneClick={() => setSelection({ kind: "none" })}
            defaultEdgeOptions={{ type: ORCH_EDGE_TYPE }}
            snapToGrid
            snapGrid={[20, 20]}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
            minZoom={0.3}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* 配置面板 */}
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l">
          <ErrorBoundary key={`${selection.kind}:${selectedNode?.id ?? selectedEdge?.id ?? "none"}`} label="orch-panel">
            {selectedNode ? (
              <>
                <OrchNodePanel
                  nodeId={selectedNode.id}
                  type={(selectedNode.type ?? "http") as OrchNodeType}
                  name={selectedNode.data.name}
                  config={selectedNode.data.config}
                  upstream={upstream}
                  credentials={credentials}
                  flows={flows.filter((f) => f.code !== meta.key)}
                  onNameChange={(name) => updateNode(selectedNode.id, { name })}
                  onConfigChange={(config) => updateNode(selectedNode.id, { config })}
                />
                <div className="border-t p-3">
                  <button type="button" onClick={removeSelected} className="text-xs text-rose-600 hover:underline">
                    删除该节点
                  </button>
                </div>
              </>
            ) : selectedEdge ? (
              <>
                {(() => {
                  // 源节点上下文：loop → 循环体开关；BRANCH 动作节点 → 失败分支开关
                  const src = nodes.find((n) => n.id === selectedEdge.source)
                  const srcType = src?.type as OrchNodeType | undefined
                  const srcOnError = src ? (src.data.config as { onError?: "ABORT" | "CONTINUE" | "BRANCH" }).onError : undefined
                  return (
                    <OrchEdgePanel
                      condition={selectedEdge.data?.condition}
                      expression={selectedEdge.data?.expression}
                      isDefault={selectedEdge.data?.isDefault}
                      loopBody={selectedEdge.data?.loopBody}
                      errorBranch={selectedEdge.data?.errorBranch}
                      sourceType={srcType}
                      sourceOnError={srcOnError}
                      upstream={upstream}
                      onChange={(patch) => updateEdge(selectedEdge.id, patch)}
                    />
                  )
                })()}
                <div className="border-t p-3">
                  <button type="button" onClick={removeSelected} className="text-xs text-rose-600 hover:underline">
                    删除该连线
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center text-muted-foreground">
                <span className="text-sm">点击节点 / 连线进行配置</span>
                <span className="text-xs">从左侧拖拽或点击新增节点；连线自动校验</span>
              </div>
            )}
          </ErrorBoundary>
        </aside>
      </div>
    </div>
  )
}

export function OrchDesigner(props: OrchDesignerProps) {
  return (
    <ReactFlowProvider>
      <OrchDesignerInner {...props} />
    </ReactFlowProvider>
  )
}
