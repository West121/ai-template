/**
 * 调色板目录：每个可拖拽/点击新增的调色板条目 → FlowNodeType + 默认 node.data 工厂。
 *
 * 一个 FlowNodeType 可能对应多个调色板条目（如 serviceTask 拆出「自动通过/自动拒绝/触发器/服务任务」，
 * 各自携带不同默认 service config），因此调色板以稳定 `key` 区分，拖拽 dataTransfer 传 `key`。
 *
 * 集中默认值，保证「拖拽新增」「点击新增」「序列化兜底」三处口径一致；禁 any。
 */
import {
  AlarmClock,
  Ban,
  CheckCheck,
  Circle,
  Clock,
  Cog,
  Layers,
  PhoneOutgoing,
  FileCode,
  Play,
  Plus,
  Send,
  Sparkles,
  Square,
  UserCheck,
  Webhook,
  X,
  Zap,
  type LucideProps,
} from "lucide-react"
import type { ComponentType } from "react"
import type { FlowNodeType } from "./model"
import type { WfNodeData } from "./serialize"

/** 拖拽时 dataTransfer 的自定义 MIME（避免与文本拖拽冲突） */
export const PALETTE_DND_MIME = "application/x-wf-flow-node"

export interface PaletteItem {
  /** 调色板条目唯一键（拖拽载荷 / 点击标识） */
  key: string
  /** 对应的 FlowNodeType（决定 react-flow node.type 与序列化） */
  type: FlowNodeType
  /** 中文标签 */
  label: string
  /** lucide 图标 */
  icon: ComponentType<LucideProps>
  /** 图标着色（调色板中区分语义） */
  colorClass: string
  /** 新增时的默认显示名 */
  defaultName: string
  /** 构造默认 node.data（含类型专属 config），保证新增即合法可序列化 */
  makeData: () => WfNodeData
}

export interface PaletteGroup {
  title: string
  items: PaletteItem[]
}

/** 调色板分组（事件 / 任务 / 网关 / OA 扩展 / 结构 / 定时） */
export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    title: "事件",
    items: [
      { key: "startEvent", type: "startEvent", label: "开始", icon: Play, colorClass: "text-emerald-500", defaultName: "开始", makeData: () => ({ name: "开始" }) },
      { key: "endEvent", type: "endEvent", label: "结束", icon: Circle, colorClass: "text-slate-500", defaultName: "结束", makeData: () => ({ name: "结束" }) },
      { key: "endTerminate", type: "endEvent", label: "终止", icon: Square, colorClass: "text-rose-600", defaultName: "终止", makeData: () => ({ name: "终止", terminate: true }) },
    ],
  },
  {
    title: "任务",
    items: [
      { key: "userTask", type: "userTask", label: "审批", icon: UserCheck, colorClass: "text-orange-500", defaultName: "审批节点", makeData: () => ({ name: "审批节点", props: { assigneeRules: [], multiMode: "ANY" } }) },
      { key: "cc", type: "cc", label: "抄送", icon: Send, colorClass: "text-sky-500", defaultName: "抄送", makeData: () => ({ name: "抄送", props: { ccUsers: [] } }) },
      { key: "ai", type: "ai", label: "AI 审批", icon: Sparkles, colorClass: "text-violet-500", defaultName: "AI 审批", makeData: () => ({ name: "AI 审批", ai: { model: "", systemPrompt: "", formContext: [], outputMap: { decision: "aiDecision", comment: "aiComment" } } }) },
      { key: "webhook", type: "webhook", label: "Webhook", icon: Webhook, colorClass: "text-teal-500", defaultName: "Webhook", makeData: () => ({ name: "Webhook", webhook: { url: "" } }) },
    ],
  },
  {
    title: "网关",
    items: [
      { key: "exclusiveGateway", type: "exclusiveGateway", label: "排它网关", icon: X, colorClass: "text-amber-500", defaultName: "排它网关", makeData: () => ({ name: "排它网关" }) },
      { key: "parallelGateway", type: "parallelGateway", label: "并行网关", icon: Plus, colorClass: "text-sky-500", defaultName: "并行网关", makeData: () => ({ name: "并行网关" }) },
      { key: "inclusiveGateway", type: "inclusiveGateway", label: "包容网关", icon: Circle, colorClass: "text-violet-500", defaultName: "包容网关", makeData: () => ({ name: "包容网关" }) },
    ],
  },
  {
    title: "自动决策 / 触发",
    items: [
      { key: "autoApprove", type: "serviceTask", label: "自动通过", icon: CheckCheck, colorClass: "text-emerald-600", defaultName: "自动通过", makeData: () => ({ name: "自动通过", service: { impl: "autoApprove" } }) },
      { key: "autoReject", type: "serviceTask", label: "自动拒绝", icon: Ban, colorClass: "text-rose-600", defaultName: "自动拒绝", makeData: () => ({ name: "自动拒绝", service: { impl: "autoReject" } }) },
      { key: "trigger", type: "serviceTask", label: "触发器", icon: Zap, colorClass: "text-amber-600", defaultName: "触发器", makeData: () => ({ name: "触发器", service: { impl: "trigger", triggerType: "IMMEDIATE" } }) },
      { key: "serviceTask", type: "serviceTask", label: "服务任务", icon: Cog, colorClass: "text-slate-600", defaultName: "服务任务", makeData: () => ({ name: "服务任务", service: { impl: "delegate", delegateExpression: "" } }) },
      { key: "scriptTask", type: "serviceTask", label: "脚本任务", icon: FileCode, colorClass: "text-fuchsia-600", defaultName: "脚本任务", makeData: () => ({ name: "脚本任务", service: { impl: "script" }, script: { lang: "groovy", code: "" } }) },
    ],
  },
  {
    title: "结构 / 定时",
    items: [
      { key: "callActivity", type: "callActivity", label: "子流程调用", icon: PhoneOutgoing, colorClass: "text-indigo-500", defaultName: "子流程调用", makeData: () => ({ name: "子流程调用", callActivity: { calledElement: "", async: false, paramMap: [] } }) },
      { key: "subProcess", type: "subProcess", label: "嵌入子流程", icon: Layers, colorClass: "text-cyan-600", defaultName: "子流程", makeData: () => ({ name: "子流程", children: { nodes: [], edges: [] } }) },
      { key: "timerCatch", type: "timerCatch", label: "定时", icon: Clock, colorClass: "text-indigo-500", defaultName: "定时", makeData: () => ({ name: "定时", timer: { mode: "duration", value: "PT1H" } }) },
      { key: "timerBoundary", type: "timerBoundary", label: "边界定时", icon: AlarmClock, colorClass: "text-rose-500", defaultName: "边界定时", makeData: () => ({ name: "边界定时", timer: { mode: "duration", value: "PT1H" }, attachedTo: "", cancelActivity: true }) },
    ],
  },
]

/** 扁平化查表（拖拽/点击回执用） */
export const PALETTE_INDEX: Record<string, PaletteItem> = Object.fromEntries(
  PALETTE_GROUPS.flatMap((g) => g.items).map((it) => [it.key, it]),
)
