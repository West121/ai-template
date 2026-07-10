/**
 * 审批节点（BPMN userTask）：圆角矩形，头部橙色标题 + 处理人摘要。入/出边俱全。
 */
import type { NodeProps } from "@xyflow/react"
import { UserCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WfRfNode } from "../serialize"
import { summarizeAssignees } from "../summary"
import { NodeHandles, NodeToolbarActions, SystemLockMark, nodeRing } from "./node-chrome"

export function ApprovalNode({ id, data, selected }: NodeProps<WfRfNode>) {
  return (
    <div
      className={cn(
        "group w-52 overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md",
        data.locked && "ring-1 ring-amber-500/40",
        nodeRing(selected, data.validation, data.highlight),
      )}
    >
      <NodeToolbarActions id={id} locked={data.locked} />
      <div className="flex h-8 items-center gap-1.5 bg-orange-500 px-3 text-xs font-medium text-white">
        <UserCheck className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{data.name || "审批节点"}</span>
        {data.locked && <SystemLockMark />}
      </div>
      <div className="truncate px-3 py-2 text-xs text-muted-foreground">{summarizeAssignees(data.props)}</div>
      <NodeHandles color="!bg-orange-500" />
    </div>
  )
}
