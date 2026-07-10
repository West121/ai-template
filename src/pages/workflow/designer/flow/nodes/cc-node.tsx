/**
 * 抄送节点（OA 扩展 → serviceTask ${wfCcDelegate}）：teal 集成家族标题 + 抄送人摘要。
 */
import type { NodeProps } from "@xyflow/react"
import { Send } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { summarizeCc } from "../summary"
import { ActivityCard } from "./node-chrome"

export function CcNode({ id, data, selected }: NodeProps<WfRfNode>) {
  return (
    <ActivityCard
      id={id}
      title={data.name || "抄送"}
      icon={Send}
      headerClass="bg-teal-600"
      handleColor="!bg-teal-600"
      selected={selected}
      validation={data.validation}
      highlight={data.highlight}
      locked={data.locked}
    >
      {summarizeCc(data.props)}
    </ActivityCard>
  )
}
