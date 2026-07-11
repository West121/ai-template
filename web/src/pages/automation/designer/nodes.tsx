/**
 * 编排节点目录（palette 分组 + 元数据）与画布节点组件（卡片风格沿现有设计器：图标 + 名称 + 摘要）。
 * 全类型共用一个卡片壳（按类型取色/图标/摘要），执行态（测试运行回放）用 data.execStatus 徽标呈现。
 */
import type { ComponentType } from "react"
import { Fragment } from "react"
import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react"
import {
  Bell,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock,
  Code2,
  Columns2,
  FileInput,
  Flag,
  GitFork,
  Globe,
  Loader2,
  Repeat2,
  Shuffle,
  Workflow,
  XCircle,
  Zap,
  type LucideProps,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  DataMapConfig,
  DelayConfig,
  HttpConfig,
  LlmConfig,
  LoopConfig,
  NotifyConfig,
  OrchNodeType,
  ParallelConfig,
  ScriptNodeConfig,
  StartApprovalConfig,
  SubFlowConfig,
  TriggerConfig,
} from "./model"
import type { OrchNodeData, OrchRfNode } from "./serialize"

/* ============================ 元数据 / palette ============================ */

export interface OrchNodeMeta {
  type: OrchNodeType
  label: string
  description: string
  icon: ComponentType<LucideProps>
  /** 标题条底色（亮暗通用的 tailwind bg-*-500/600） */
  headerClass: string
  handleColor: string
}

export const NODE_META: Record<OrchNodeType, OrchNodeMeta> = {
  trigger: { type: "trigger", label: "触发器", description: "手动 / 定时 / 事件 / Webhook", icon: Zap, headerClass: "bg-emerald-600", handleColor: "!bg-emerald-600" },
  condition: { type: "condition", label: "条件分支", description: "多出边 = Switch 多路（每边一条件 + 默认支）", icon: GitFork, headerClass: "bg-amber-600", handleColor: "!bg-amber-600" },
  parallel: { type: "parallel", label: "并行", description: "开叉 / 汇合（WHEN）", icon: Columns2, headerClass: "bg-amber-600", handleColor: "!bg-amber-600" },
  loop: { type: "loop", label: "循环", description: "遍历集合逐项执行", icon: Repeat2, headerClass: "bg-amber-600", handleColor: "!bg-amber-600" },
  delay: { type: "delay", label: "延时", description: "等待 N 毫秒（≤5 分钟）", icon: Clock, headerClass: "bg-amber-600", handleColor: "!bg-amber-600" },
  http: { type: "http", label: "HTTP 调用", description: "调外部/内部接口", icon: Globe, headerClass: "bg-blue-600", handleColor: "!bg-blue-600" },
  script: { type: "script", label: "脚本", description: "Groovy / JS / Python（受信）", icon: Code2, headerClass: "bg-fuchsia-600", handleColor: "!bg-fuchsia-600" },
  dataMap: { type: "dataMap", label: "数据映射", description: "表达式赋值 vars", icon: Shuffle, headerClass: "bg-slate-600", handleColor: "!bg-slate-600" },
  notify: { type: "notify", label: "站内通知", description: "给指定人发通知", icon: Bell, headerClass: "bg-teal-600", handleColor: "!bg-teal-600" },
  startApproval: { type: "startApproval", label: "发起审批", description: "起一条审批流实例", icon: FileInput, headerClass: "bg-orange-600", handleColor: "!bg-orange-600" },
  subFlow: { type: "subFlow", label: "子编排", description: "调用另一条编排（≤5 层）", icon: Workflow, headerClass: "bg-indigo-600", handleColor: "!bg-indigo-600" },
  llm: { type: "llm", label: "AI（LLM）", description: "OpenAI 兼容端点，TEXT/JSON 输出", icon: Bot, headerClass: "bg-violet-600", handleColor: "!bg-violet-600" },
  end: { type: "end", label: "结束", description: "可选输出表达式", icon: Flag, headerClass: "bg-slate-500", handleColor: "!bg-slate-500" },
}

/** palette 分组（契约 §5.1） */
export const PALETTE_GROUPS: { label: string; types: OrchNodeType[] }[] = [
  { label: "触发", types: ["trigger"] },
  { label: "逻辑", types: ["condition", "parallel", "loop", "delay"] },
  { label: "动作", types: ["http", "script", "dataMap", "notify", "startApproval", "subFlow", "end"] },
  { label: "AI", types: ["llm"] },
]

export const ORCH_DND_MIME = "application/x-orch-node"

/* ============================ 摘要 ============================ */

const TRIGGER_LABEL: Record<TriggerConfig["triggerType"], string> = {
  MANUAL: "手动",
  CRON: "定时",
  EVENT: "事件",
  WEBHOOK: "Webhook",
}

export function summarizeNode(type: OrchNodeType, data: OrchNodeData): string {
  const c = data.config
  switch (type) {
    case "trigger": {
      const cfg = c as TriggerConfig
      if (cfg.triggerType === "CRON") return `定时 ${cfg.cron || "（未配置）"}`
      if (cfg.triggerType === "EVENT") return `事件 ${cfg.event?.type || "（未配置）"}`
      return TRIGGER_LABEL[cfg.triggerType] ?? cfg.triggerType
    }
    case "http": {
      const cfg = c as HttpConfig
      return cfg.url ? `${cfg.method} ${cfg.url}` : "未配置 URL"
    }
    case "script": {
      const cfg = c as ScriptNodeConfig
      return cfg.script.code ? `${cfg.script.lang} 脚本` : "未编写脚本"
    }
    case "condition":
      return "按出边条件走一路"
    case "parallel":
      return (c as ParallelConfig).mode === "JOIN" ? "汇合（各支输出可引用）" : "并行开叉"
    case "loop": {
      const cfg = c as LoopConfig
      return cfg.collection ? `遍历 ${cfg.collection}` : "未配置集合"
    }
    case "delay":
      return `${(c as DelayConfig).ms} ms`
    case "notify": {
      const cfg = c as NotifyConfig
      return cfg.recipients.length ? `通知 ${cfg.recipients.length} 个对象` : "未选收件人"
    }
    case "startApproval": {
      const cfg = c as StartApprovalConfig
      return cfg.defCode ? `发起 ${cfg.defCode}` : "未选流程"
    }
    case "dataMap": {
      const n = (c as DataMapConfig).assignments.filter((a) => a.target).length
      return n ? `${n} 条赋值` : "未配置赋值"
    }
    case "subFlow": {
      const cfg = c as SubFlowConfig
      return cfg.flowCode ? `调用 ${cfg.flowCode}${cfg.waitResult ? "（等结果）" : ""}` : "未选目标编排"
    }
    case "llm": {
      const cfg = c as LlmConfig
      return cfg.userPrompt ? `${cfg.outputMode} · ${cfg.model || "默认模型"}` : "未配置提示词"
    }
    case "end":
      return "结束"
  }
}

/* ============================ 画布节点组件 ============================ */

const EXEC_BADGE: Record<NonNullable<OrchNodeData["execStatus"]>, { icon: ComponentType<LucideProps>; cls: string }> = {
  RUNNING: { icon: Loader2, cls: "text-blue-500 animate-spin" },
  SUCCESS: { icon: CheckCircle2, cls: "text-emerald-500" },
  FAILED: { icon: XCircle, cls: "text-rose-500" },
  SKIPPED: { icon: CircleDot, cls: "text-muted-foreground/50" },
}

const HANDLE_SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const

function OrchCard({ id: _id, type, data, selected }: NodeProps<OrchRfNode>) {
  const meta = NODE_META[(type ?? "http") as OrchNodeType]
  const Icon = meta.icon
  const exec = data.execStatus ? EXEC_BADGE[data.execStatus] : null
  const noIn = type === "trigger"
  const noOut = type === "end"
  return (
    <div
      className={cn(
        "group w-52 overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md",
        data.validation === "error" && "ring-2 ring-destructive ring-offset-2 ring-offset-background",
        data.validation === "warning" && "ring-2 ring-amber-500 ring-offset-2 ring-offset-background",
        !data.validation && selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <div className={cn("flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-white", meta.headerClass)}>
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{data.name || meta.label}</span>
        {exec && <exec.icon className={cn("size-3.5 shrink-0", exec.cls)} />}
      </div>
      <div className="truncate px-3 py-2 text-xs text-muted-foreground">{summarizeNode(meta.type, data)}</div>
      {HANDLE_SIDES.map((pos) => (
        <Fragment key={pos}>
          {!noOut && (
            <Handle
              type="source"
              id={`s-${pos}`}
              position={pos}
              className={cn(
                "!size-2.5 !rounded-full !border-2 !border-background opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                meta.handleColor,
              )}
            />
          )}
          {!noIn && (
            <Handle
              type="target"
              id={`t-${pos}`}
              position={pos}
              className={cn(
                "!size-2.5 !rounded-full !border-2 !border-background opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                meta.handleColor,
              )}
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}

/** react-flow nodeTypes：13 类共用同一卡片壳 */
export const orchNodeTypes: NodeTypes = Object.fromEntries(
  (Object.keys(NODE_META) as OrchNodeType[]).map((t) => [t, OrchCard]),
) as NodeTypes
