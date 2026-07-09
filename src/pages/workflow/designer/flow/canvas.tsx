/**
 * 下一代流程设计器 · react-flow 画布容器（切片 1 核心）。
 *
 * 受控组件：nodes/edges 及其变更处理由上层（flow-designer）持有，画布只负责渲染
 * ReactFlow + Background + Controls，注册核心 nodeTypes/edgeTypes，并把选中/连线/空白点击
 * 事件回调上抛。BPMN 连接规则完整校验、调色板拖拽、自动布局等推迟到后续切片。
 */
import { useCallback } from "react"
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react"
import { Controls } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { edgeTypes } from "./edges"
import { nodeTypes } from "./nodes"
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
}

export function FlowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeSelect,
  onEdgeSelect,
  onPaneClick,
}: FlowCanvasProps) {
  const dark = isDarkMode(useAppStore((s) => s.themeMode))

  const handleNodeClick = useCallback(
    (_: unknown, node: WfRfNode) => onNodeSelect(node.id),
    [onNodeSelect],
  )
  const handleEdgeClick = useCallback(
    (_: unknown, edge: WfRfEdge) => onEdgeSelect(edge.id),
    [onEdgeSelect],
  )

  return (
    <ReactFlowProvider>
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
    </ReactFlowProvider>
  )
}
