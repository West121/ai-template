/**
 * 只读流程图渲染器 `FlowViewer`（替换 bpmn-js NavigatedViewer 的运行时跟踪图）。
 *
 * 基于新 react-flow 设计器的画布层的**只读变体**：复用同一套 nodeTypes / edgeTypes / 节点组件，
 * 渲染归一化 `ProcessModel` + 运行时 `highlight`（completed 已完成路径 / active 当前节点）。
 *  - 数据来源：由调用方把后端 bpmnXml 经 `POST /api/wf/models/import` 转成 ProcessModel 后传入
 *    （见 instance-detail.tsx，含缓存避免每次转）。
 *  - 高亮映射：**节点 id == BPMN 元素 id == highlight id**，直接按 id 命中 completed/active，
 *    注入到展示副本的 `data.highlight`（瞬态、不序列化），复用节点组件已打磨的高亮环样式（node-chrome）。
 *  - 只读：nodesDraggable/nodesConnectable/elementsSelectable 全关，无调色板/属性面板/删除键。
 *
 * 暗色态：随 app-store themeMode 走 ReactFlow colorMode；高亮色用 token（--primary）/ emerald 常量，双态自适应。
 * 禁 any；类型导入一律 import type。
 */
import { useMemo } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import type { WfHighlight } from "@/types/workflow"
import { edgeTypes } from "./edges"
import { nodeTypes } from "./nodes"
import type { NodeHighlightState } from "./nodes/node-chrome"
import type { ProcessModel } from "./model"
import { fromProcessModel, type WfRfEdge, type WfRfNode } from "./serialize"

/** 进行中节点的脉冲动画（`wf-hl-active` 由 node-chrome 的 nodeRing 注入到节点壳）。与设计器态无关。 */
const VIEWER_CSS = `
@keyframes wf-hl-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--primary); }
  50% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 35%, transparent); }
}
.wf-flow-viewer .wf-hl-active { animation: wf-hl-pulse 1.6s ease-in-out infinite; }
`

export interface FlowViewerProps {
  /** 归一化流程模型（由 .bpmn 经 /api/wf/models/import 转出，或直接来自 GRAPH 定义） */
  model: ProcessModel
  /** 运行时高亮：completed=已完成、active=当前节点；id 与节点/边 id 对齐 */
  highlight?: WfHighlight
  /** 画布容器高度 class，默认 h-105（与旧 bpmn 跟踪图一致） */
  heightClass?: string
  className?: string
}

function FlowViewerInner({ model, highlight, heightClass = "h-105", className }: FlowViewerProps) {
  const dark = isDarkMode(useAppStore((s) => s.themeMode))

  const { nodes, edges } = useMemo(() => {
    const base = fromProcessModel(model)
    const completed = new Set(highlight?.completed ?? [])
    const active = new Set(highlight?.active ?? [])
    const stateOf = (id: string): NodeHighlightState | undefined =>
      active.has(id) ? "active" : completed.has(id) ? "completed" : undefined

    const nodes: WfRfNode[] = base.nodes.map((n) => {
      const state = stateOf(n.id)
      // 只读：清除选中态，注入高亮态（瞬态渲染字段，不影响序列化）
      return state ? { ...n, selected: false, data: { ...n.data, highlight: state } } : { ...n, selected: false }
    })
    const edges: WfRfEdge[] = base.edges.map((e) => {
      const state = stateOf(e.id)
      return state ? { ...e, data: { ...e.data, highlight: state } } : e
    })
    return { nodes, edges }
  }, [model, highlight])

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
    <div className={cn("wf-flow-viewer relative w-full rounded-md border bg-background", heightClass, className)}>
      <style>{VIEWER_CSS}</style>
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
