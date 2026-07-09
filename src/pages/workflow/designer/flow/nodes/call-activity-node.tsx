/**
 * 调用活动节点（BPMN callActivity）：调用已部署子流程。靛蓝标题 + 子流程编码/同异步摘要。
 * 用加粗左右边框（BPMN callActivity 惯例的"粗框"）以区别普通任务。
 */
import type { NodeProps } from "@xyflow/react"
import { PhoneOutgoing } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { summarizeCallActivity } from "../summary"
import { ActivityCard } from "./node-chrome"

export function CallActivityNode({ data, selected }: NodeProps<WfRfNode>) {
  return (
    <ActivityCard
      title={data.name || "子流程调用"}
      icon={PhoneOutgoing}
      headerClass="bg-indigo-500"
      handleColor="!bg-indigo-500"
      selected={selected}
      className="border-x-4 border-x-indigo-400/60"
    >
      {summarizeCallActivity(data.callActivity)}
    </ActivityCard>
  )
}
