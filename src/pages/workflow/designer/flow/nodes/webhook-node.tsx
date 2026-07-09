/**
 * Webhook 节点（OA 扩展 → serviceTask ${wfWebhookDelegate}）：青色标题 + 回调地址摘要。
 */
import type { NodeProps } from "@xyflow/react"
import { Webhook } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { summarizeWebhook } from "../summary"
import { ActivityCard } from "./node-chrome"

export function WebhookNode({ data, selected }: NodeProps<WfRfNode>) {
  return (
    <ActivityCard
      title={data.name || "Webhook"}
      icon={Webhook}
      headerClass="bg-teal-500"
      handleColor="!bg-teal-500"
      selected={selected}
    >
      {summarizeWebhook(data.webhook)}
    </ActivityCard>
  )
}
