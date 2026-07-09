/**
 * 嵌入式子流程节点（BPMN subProcess）：双框外观（外框 + 内嵌虚线框）表达"内含独立子图"。
 * 可折叠显示：折叠时仅标题条；展开时显示子图节点/边计数摘要。
 * children（内联子图）的深度编辑推迟到后续切片，本节点仅承载与展示。
 */
import { useState } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { ChevronDown, ChevronRight, Layers } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WfRfNode } from "../serialize"
import { NodeToolbarActions, handleClass, nodeRing } from "./node-chrome"

export function SubProcessNode({ id, data, selected }: NodeProps<WfRfNode>) {
  const [expanded, setExpanded] = useState(true)
  const childNodes = data.children?.nodes.length ?? 0
  const childEdges = data.children?.edges.length ?? 0

  return (
    <div
      className={cn(
        "w-52 overflow-hidden rounded-lg border-2 border-indigo-500/70 bg-card shadow-sm transition-shadow hover:shadow-md",
        nodeRing(selected, data.validation),
      )}
    >
      <NodeToolbarActions id={id} />
      <div className="flex h-8 items-center gap-1.5 bg-indigo-600 px-2.5 text-xs font-medium text-white">
        <button
          type="button"
          className="rounded p-0.5 hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          aria-label={expanded ? "折叠子流程" : "展开子流程"}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <Layers className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{data.name || "子流程"}</span>
      </div>
      {expanded && (
        <div className="p-2">
          {/* 内嵌虚线框：BPMN 子流程"双框"语义 */}
          <div className="rounded-md border border-dashed border-indigo-500/50 bg-indigo-500/5 px-2.5 py-3 text-center text-xs text-muted-foreground">
            {childNodes > 0 ? `内含 ${childNodes} 节点 · ${childEdges} 连线` : "空子流程（内含独立子图）"}
          </div>
        </div>
      )}
      <Handle type="target" position={Position.Top} className={handleClass("!bg-indigo-600")} />
      <Handle type="source" position={Position.Bottom} className={handleClass("!bg-indigo-600")} />
    </div>
  )
}
