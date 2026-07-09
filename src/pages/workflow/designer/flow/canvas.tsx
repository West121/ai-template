/**
 * 下一代流程设计器 · react-flow 画布容器。
 *
 * 受控组件：nodes/edges 及其变更处理由上层（flow-designer）持有，画布只负责渲染
 * ReactFlow + Background + Controls，注册 nodeTypes/edgeTypes，并把选中/连线/空白点击
 * 事件回调上抛。切片 2 新增：调色板拖拽落点 —— onDrop 用 `screenToFlowPosition` 把
 * 屏幕坐标换算为画布坐标，回调 `onDropNode(paletteKey, position)` 由上层新增节点。
 */
import { useCallback, type DragEvent } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { edgeTypes } from "./edges"
import { PALETTE_DND_MIME } from "./node-catalog"
import { nodeTypes } from "./nodes"
import type { Point } from "./model"
import type { WfRfEdge, WfRfNode } from "./serialize"

export interface FlowCanvasProps {
  nodes: WfRfNode[]
  edges: WfRfEdge[]
  onNodesChange: (changes: NodeChange<WfRfNode>[]) => void
  onEdgesChange: (changes: EdgeChange<WfRfEdge>[]) => void
  onConnect: OnConnect
  /** 选中节点（点击节点卡片） */
  onNodeSelect: (id: string) => void
  /** 选中边（点击连线，用于编辑分支条件） */
  onEdgeSelect: (id: string) => void
  /** 点击空白处（回到流程级属性） */
  onPaneClick: () => void
  /** 调色板拖拽落点新增节点：paletteKey 为 node-catalog 条目键，position 为画布坐标 */
  onDropNode: (paletteKey: string, position: Point) => void
}

function FlowCanvasInner(props: FlowCanvasProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, onNodeSelect, onEdgeSelect, onPaneClick, onDropNode } =
    props
  const dark = isDarkMode(useAppStore((s) => s.themeMode))
  const { screenToFlowPosition } = useReactFlow<WfRfNode, WfRfEdge>()

  const handleNodeClick = useCallback((_: unknown, node: WfRfNode) => onNodeSelect(node.id), [onNodeSelect])
  const handleEdgeClick = useCallback((_: unknown, edge: WfRfEdge) => onEdgeSelect(edge.id), [onEdgeSelect])

  const handleDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(PALETTE_DND_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    }
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      const key = e.dataTransfer.getData(PALETTE_DND_MIME)
      if (!key) return
      e.preventDefault()
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      onDropNode(key, position)
    },
    [screenToFlowPosition, onDropNode],
  )

  return (
    <div className="size-full" onDragOver={handleDragOver} onDrop={handleDrop}>
      <ReactFlow<WfRfNode, WfRfEdge>
        colorMode={dark ? "dark" : "light"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={onPaneClick}
        defaultEdgeOptions={{ type: "sequenceFlow" }}
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
  )
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
