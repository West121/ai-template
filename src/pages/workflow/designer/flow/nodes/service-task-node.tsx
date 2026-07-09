/**
 * 服务任务节点（BPMN serviceTask，delegateExpression）。
 * 按 data.service.impl 判别自适应图标/配色：
 *  - autoApprove：自动通过（绿）
 *  - autoReject ：自动驳回（玫红）
 *  - trigger    ：触发器（琥珀）
 *  - delegate   ：通用委托（石板灰）
 */
import type { NodeProps } from "@xyflow/react"
import { Ban, CheckCheck, Cog, Zap, type LucideProps } from "lucide-react"
import type { ComponentType } from "react"
import type { ServiceTaskConfig } from "../model"
import type { WfRfNode } from "../serialize"
import { summarizeService } from "../summary"
import { ActivityCard } from "./node-chrome"

type Impl = ServiceTaskConfig["impl"]

const SERVICE_META: Record<Impl, { icon: ComponentType<LucideProps>; headerClass: string; handleColor: string }> = {
  autoApprove: { icon: CheckCheck, headerClass: "bg-emerald-600", handleColor: "!bg-emerald-600" },
  autoReject: { icon: Ban, headerClass: "bg-rose-600", handleColor: "!bg-rose-600" },
  trigger: { icon: Zap, headerClass: "bg-amber-600", handleColor: "!bg-amber-600" },
  delegate: { icon: Cog, headerClass: "bg-slate-600", handleColor: "!bg-slate-600" },
}

export function ServiceTaskNode({ data, selected }: NodeProps<WfRfNode>) {
  const impl: Impl = data.service?.impl ?? "delegate"
  const meta = SERVICE_META[impl]
  return (
    <ActivityCard
      title={data.name || "服务任务"}
      icon={meta.icon}
      headerClass={meta.headerClass}
      handleColor={meta.handleColor}
      selected={selected}
    >
      {summarizeService(data.service)}
    </ActivityCard>
  )
}
