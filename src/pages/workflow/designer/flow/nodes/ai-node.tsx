/**
 * AI 审批节点（OA 扩展 → serviceTask ${wfAiApprovalDelegate}）：teal 集成家族更亮一档标题 + 模型摘要。
 */
import type { NodeProps } from "@xyflow/react"
import { Sparkles } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { summarizeAi } from "../summary"
import { ActivityCard } from "./node-chrome"

export function AiNode({ id, data, selected }: NodeProps<WfRfNode>) {
  return (
    <ActivityCard
      id={id}
      title={data.name || "AI 审批"}
      icon={Sparkles}
      headerClass="bg-teal-500"
      handleColor="!bg-teal-500"
      selected={selected}
      validation={data.validation}
      highlight={data.highlight}
      locked={data.locked}
    >
      {summarizeAi(data.ai)}
    </ActivityCard>
  )
}
