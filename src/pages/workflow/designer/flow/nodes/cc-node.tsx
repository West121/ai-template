/**
 * 抄送节点（OA 扩展 → serviceTask ${wfCcDelegate}）：天蓝标题 + 抄送人摘要。
 */
import type { NodeProps } from "@xyflow/react"
import { Send } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { summarizeCc } from "../summary"
import { ActivityCard } from "./node-chrome"

export function CcNode({ data, selected }: NodeProps<WfRfNode>) {
  return (
    <ActivityCard
      title={data.name || "抄送"}
      icon={Send}
      headerClass="bg-sky-500"
      handleColor="!bg-sky-500"
      selected={selected}
    >
      {summarizeCc(data.props)}
    </ActivityCard>
  )
}
