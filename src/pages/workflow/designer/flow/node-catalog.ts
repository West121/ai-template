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
  CircleDot,
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
import type { FlowNodeType, Size } from "./model"
import type { WfNodeData } from "./serialize"

/**
 * 节点渲染尺寸常量（W-03，跨端一致性）：`makeData()` 把与画布**实际渲染**一致的 `size`
 * 写进 node.data，序列化后进入 ProcessModel，后端据此生成 BPMN DI（BPMNShape），
 * 避免后端按兜底默认（事件 30 / 网关 40 / 任务 100×60）补图导致图形错位、连线锚点偏移。
 *  - 事件圆：外径 48（start/end-event-node `size-12`、timer 双圈 `size-12`）
 *  - 网关菱形：外框 48×48（GatewayShell `relative size-12`；对角 ≈68 仅视觉，DI 取包围盒 48）
 *  - 活动卡：宽 w-52(208)，高含头部条 h-8 + 单行摘要 ≈ 64
 *  - 子流程：与活动卡同宽 208，内嵌子图框更高 ≈ 96
 */
const EVENT_SIZE: Size = { w: 48, h: 48 }
const GATEWAY_SIZE: Size = { w: 48, h: 48 }
const ACTIVITY_SIZE: Size = { w: 208, h: 64 }
const SUBPROCESS_SIZE: Size = { w: 208, h: 96 }

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
      { key: "startEvent", type: "startEvent", label: "开始", icon: Play, colorClass: "text-emerald-500", defaultName: "开始", makeData: () => ({ name: "开始", size: EVENT_SIZE }) },
      { key: "endEvent", type: "endEvent", label: "结束", icon: Circle, colorClass: "text-slate-500", defaultName: "结束", makeData: () => ({ name: "结束", size: EVENT_SIZE }) },
      { key: "endTerminate", type: "endEvent", label: "终止", icon: Square, colorClass: "text-rose-600", defaultName: "终止", makeData: () => ({ name: "终止", terminate: true, size: EVENT_SIZE }) },
    ],
  },
  {
    title: "任务",
    items: [
      { key: "userTask", type: "userTask", label: "审批", icon: UserCheck, colorClass: "text-orange-500", defaultName: "审批节点", makeData: () => ({ name: "审批节点", props: { assigneeRules: [], multiMode: "ANY" }, size: ACTIVITY_SIZE }) },
      // OA 集成家族（裁定 B）：cc/webhook = teal-600，AI = 家族内更亮一档 teal-500，靠图标区分
      { key: "cc", type: "cc", label: "抄送", icon: Send, colorClass: "text-teal-600", defaultName: "抄送", makeData: () => ({ name: "抄送", props: { ccUsers: [] }, size: ACTIVITY_SIZE }) },
      { key: "ai", type: "ai", label: "AI 审批", icon: Sparkles, colorClass: "text-teal-500", defaultName: "AI 审批", makeData: () => ({ name: "AI 审批", ai: { model: "", systemPrompt: "", formContext: [], outputMap: { decision: "aiDecision", comment: "aiComment" } }, size: ACTIVITY_SIZE }) },
      { key: "webhook", type: "webhook", label: "Webhook", icon: Webhook, colorClass: "text-teal-600", defaultName: "Webhook", makeData: () => ({ name: "Webhook", webhook: { url: "" }, size: ACTIVITY_SIZE }) },
    ],
  },
  {
    title: "网关",
    // 裁定 A1：三类网关统一 amber 色相，靠内部标记 X（排它）/＋（并行）/◯（包容）区分
    items: [
      { key: "exclusiveGateway", type: "exclusiveGateway", label: "排它网关", icon: X, colorClass: "text-amber-500", defaultName: "排它网关", makeData: () => ({ name: "排它网关", size: GATEWAY_SIZE }) },
      { key: "parallelGateway", type: "parallelGateway", label: "并行网关", icon: Plus, colorClass: "text-amber-500", defaultName: "并行网关", makeData: () => ({ name: "并行网关", size: GATEWAY_SIZE }) },
      { key: "inclusiveGateway", type: "inclusiveGateway", label: "包容网关", icon: CircleDot, colorClass: "text-amber-500", defaultName: "包容网关", makeData: () => ({ name: "包容网关", size: GATEWAY_SIZE }) },
    ],
  },
  {
    title: "自动决策 / 触发",
    items: [
      { key: "autoApprove", type: "serviceTask", label: "自动通过", icon: CheckCheck, colorClass: "text-emerald-600", defaultName: "自动通过", makeData: () => ({ name: "自动通过", service: { impl: "autoApprove" }, size: ACTIVITY_SIZE }) },
      { key: "autoReject", type: "serviceTask", label: "自动驳回", icon: Ban, colorClass: "text-rose-600", defaultName: "自动驳回", makeData: () => ({ name: "自动驳回", service: { impl: "autoReject" }, size: ACTIVITY_SIZE }) },
      { key: "trigger", type: "serviceTask", label: "触发器", icon: Zap, colorClass: "text-amber-600", defaultName: "触发器", makeData: () => ({ name: "触发器", service: { impl: "trigger", triggerType: "IMMEDIATE" }, size: ACTIVITY_SIZE }) },
      { key: "serviceTask", type: "serviceTask", label: "服务任务", icon: Cog, colorClass: "text-slate-600", defaultName: "服务任务", makeData: () => ({ name: "服务任务", service: { impl: "delegate", delegateExpression: "" }, size: ACTIVITY_SIZE }) },
      { key: "scriptTask", type: "serviceTask", label: "脚本任务", icon: FileCode, colorClass: "text-fuchsia-600", defaultName: "脚本任务", makeData: () => ({ name: "脚本任务", service: { impl: "script" }, script: { lang: "groovy", code: "" }, size: ACTIVITY_SIZE }) },
    ],
  },
  {
    title: "结构 / 定时",
    // 结构/定时统一 indigo 家族（timerBoundary 从 rose 挪入 indigo，rose 归还「异常终止/驳回」）
    items: [
      { key: "callActivity", type: "callActivity", label: "子流程调用", icon: PhoneOutgoing, colorClass: "text-indigo-500", defaultName: "子流程调用", makeData: () => ({ name: "子流程调用", callActivity: { calledElement: "", async: false, paramMap: [] }, size: ACTIVITY_SIZE }) },
      { key: "subProcess", type: "subProcess", label: "嵌入子流程", icon: Layers, colorClass: "text-indigo-500", defaultName: "子流程", makeData: () => ({ name: "子流程", children: { nodes: [], edges: [] }, size: SUBPROCESS_SIZE }) },
      { key: "timerCatch", type: "timerCatch", label: "定时", icon: Clock, colorClass: "text-indigo-500", defaultName: "定时", makeData: () => ({ name: "定时", timer: { mode: "duration", value: "PT1H" }, size: EVENT_SIZE }) },
      { key: "timerBoundary", type: "timerBoundary", label: "边界定时", icon: AlarmClock, colorClass: "text-indigo-500", defaultName: "边界定时", makeData: () => ({ name: "边界定时", timer: { mode: "duration", value: "PT1H" }, attachedTo: "", cancelActivity: true, size: EVENT_SIZE }) },
    ],
  },
]

/** 扁平化查表（拖拽/点击回执用） */
export const PALETTE_INDEX: Record<string, PaletteItem> = Object.fromEntries(
  PALETTE_GROUPS.flatMap((g) => g.items).map((it) => [it.key, it]),
)
