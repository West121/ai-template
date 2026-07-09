/**
 * 下一代流程设计器 · react-flow 画布容器。
 *
 * 受控组件：nodes/edges 及其变更处理由上层（flow-designer）持有，画布只负责渲染
 * ReactFlow + Background + Controls，注册 nodeTypes/edgeTypes，并把选中/连线/空白点击
 * 事件回调上抛。
 *  - 调色板拖拽落点：onDrop 用 `screenToFlowPosition` 换算画布坐标，回调 `onDropNode`。
 *  - W-11：`isValidConnection` 让拖拽连线过程即时红/绿反馈（复用 validate.ts 规则）。
 *  - W-13：`snapToGrid` 对齐 20×20 点阵，避免 DI 坐标杂乱。
 *  - W-16：拖拽悬停时画布加 `ring` 落区高亮。
 *  - W-21：空画布居中引导。
 *  - W-14/W-17：通过 `onReady` 上抛聚焦/取视口中心的命令式 API。
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { MousePointerClick } from "lucide-react"
import { isDarkMode } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/stores/app-store"
import { edgeTypes } from "./edges"
import { PALETTE_DND_MIME } from "./node-catalog"
import { nodeTypes } from "./nodes"
import type { Point } from "./model"
import type { WfRfEdge, WfRfNode } from "./serialize"

/** 命令式画布 API（供上层聚焦校验错误元素、在视口中心新增节点） */
export interface FlowCanvasApi {
  /** 选中并居中某节点或边（校验错误清单点击定位用） */
  focus: (target: { nodeId?: string; edgeId?: string }) => void
  /** 当前视口中心对应的画布坐标（点击新增落点用） */
  toFlowCenter: () => Point
}

export interface FlowCanvasProps {
  nodes: WfRfNode[]
  edges: WfRfEdge[]
  onNodesChange: (changes: NodeChange<WfRfNode>[]) => void
  onEdgesChange: (changes: EdgeChange<WfRfEdge>[]) => void
  onConnect: OnConnect
  /** 拖拽连线过程即时合法性反馈（W-11） */
  isValidConnection: IsValidConnection<WfRfEdge>
  /** 选中节点（点击节点卡片） */
  onNodeSelect: (id: string) => void
  /** 选中边（点击连线，用于编辑分支条件） */
  onEdgeSelect: (id: string) => void
  /** 点击空白处（回到流程级属性） */
  onPaneClick: () => void
  /** 调色板拖拽落点新增节点：paletteKey 为 node-catalog 条目键，position 为画布坐标 */
  onDropNode: (paletteKey: string, position: Point) => void
  /** 画布就绪时上抛命令式 API */
  onReady?: (api: FlowCanvasApi) => void
}

function FlowCanvasInner(props: FlowCanvasProps) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    isValidConnection,
    onNodeSelect,
    onEdgeSelect,
    onPaneClick,
    onDropNode,
    onReady,
  } = props
  const dark = isDarkMode(useAppStore((s) => s.themeMode))
  const { screenToFlowPosition, getNode, getEdge, setCenter } = useReactFlow<WfRfNode, WfRfEdge>()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleNodeClick = useCallback((_: unknown, node: WfRfNode) => onNodeSelect(node.id), [onNodeSelect])
  const handleEdgeClick = useCallback((_: unknown, edge: WfRfEdge) => onEdgeSelect(edge.id), [onEdgeSelect])

  const handleDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(PALETTE_DND_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
      setDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    // 仅当离开画布容器本身（而非内部子元素）时清除高亮
    if (e.currentTarget === e.target) setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      setDragOver(false)
      const key = e.dataTransfer.getData(PALETTE_DND_MIME)
      if (!key) return
      e.preventDefault()
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      onDropNode(key, position)
    },
    [screenToFlowPosition, onDropNode],
  )

  /* ---- 命令式 API：聚焦校验错误元素 / 取视口中心（W-14 / W-17） ---- */
  const centerOn = useCallback(
    (x: number, y: number) => setCenter(x, y, { zoom: 1.2, duration: 400 }),
    [setCenter],
  )
  const focus = useCallback(
    (target: { nodeId?: string; edgeId?: string }) => {
      if (target.nodeId) {
        const n = getNode(target.nodeId)
        if (n) centerOn(n.position.x + (n.measured?.width ?? 100) / 2, n.position.y + (n.measured?.height ?? 40) / 2)
        return
      }
      if (target.edgeId) {
        const e = getEdge(target.edgeId)
        if (!e) return
        const s = getNode(e.source)
        const t = getNode(e.target)
        if (s && t) centerOn((s.position.x + t.position.x) / 2 + 50, (s.position.y + t.position.y) / 2 + 20)
      }
    },
    [getNode, getEdge, centerOn],
  )
  const toFlowCenter = useCallback((): Point => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return { x: 240, y: 120 }
    return screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }, [screenToFlowPosition])

  useEffect(() => {
    onReady?.({ focus, toFlowCenter })
  }, [onReady, focus, toFlowCenter])

  return (
    <div
      ref={wrapperRef}
      className={cn("relative size-full", dragOver && "rounded-sm ring-2 ring-inset ring-primary/40")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ReactFlow<WfRfNode, WfRfEdge>
        colorMode={dark ? "dark" : "light"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={onPaneClick}
        defaultEdgeOptions={{ type: "sequenceFlow" }}
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

      {/* 空态引导（W-21）：无节点时居中提示，浮于点阵之上，不拦截交互 */}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
          <MousePointerClick className="size-8 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">从左侧拖拽节点开始搭建流程</p>
          <p className="text-xs text-muted-foreground/70">或点击调色板条目在画布中央新增</p>
        </div>
      )}
    </div>
  )
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
