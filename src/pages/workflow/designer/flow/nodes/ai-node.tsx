/**
 * AI 审批节点（OA 扩展 → serviceTask ${wfAiApprovalDelegate}）：紫罗兰标题 + 模型摘要。
 */
import type { NodeProps } from "@xyflow/react"
import { Sparkles } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { summarizeAi } from "../summary"
import { ActivityCard } from "./node-chrome"

export function AiNode({ data, selected }: NodeProps<WfRfNode>) {
  return (
    <ActivityCard
      title={data.name || "AI 审批"}
      icon={Sparkles}
      headerClass="bg-violet-500"
      handleColor="!bg-violet-500"
      selected={selected}
    >
      {summarizeAi(data.ai)}
    </ActivityCard>
  )
}
