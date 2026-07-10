/**
 * Webhook 节点（OA 扩展 → serviceTask ${wfWebhookDelegate}）：teal 集成家族标题 + 回调地址摘要。
 */
import type { NodeProps } from "@xyflow/react"
import { Webhook } from "lucide-react"
import type { WfRfNode } from "../serialize"
import { summarizeWebhook } from "../summary"
import { ActivityCard } from "./node-chrome"

export function WebhookNode({ id, data, selected }: NodeProps<WfRfNode>) {
  return (
    <ActivityCard
      id={id}
      title={data.name || "Webhook"}
      icon={Webhook}
      headerClass="bg-teal-600"
      handleColor="!bg-teal-600"
      selected={selected}
      validation={data.validation}
      highlight={data.highlight}
      locked={data.locked}
    >
      {summarizeWebhook(data.webhook)}
    </ActivityCard>
  )
}
