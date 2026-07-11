/**
 * 执行记录呈现：节点时间线（状态/耗时/输入输出 JSON 展开/错误）——测试运行抽屉与执行记录详情共用。
 * 批3：Agent 节点展示 steps 明细（exec_node.output.steps：每步工具名/args/结果）；
 *      WAITING 挂起态琥珀徽标 + 恢复回调地址可复制（WaitingResumeBar）。
 */
import { useState } from "react"
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  Hourglass,
  Loader2,
  Wrench,
  XCircle,
  type LucideProps,
} from "lucide-react"
import type { ComponentType } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { OrchExecNode, OrchExecStatus } from "./mock"

export const EXEC_STATUS_META: Record<OrchExecStatus, { label: string; className: string }> = {
  RUNNING: { label: "执行中", className: "border-blue-500/30 bg-blue-500/10 text-blue-600" },
  WAITING: { label: "挂起等待", className: "border-amber-500/30 bg-amber-500/10 text-amber-600" },
  SUCCESS: { label: "成功", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  FAILED: { label: "失败", className: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
  CANCELED: { label: "已取消", className: "text-muted-foreground" },
}

const NODE_STATUS: Record<OrchExecNode["status"], { icon: ComponentType<LucideProps>; cls: string; label: string }> = {
  RUNNING: { icon: Loader2, cls: "text-blue-500 animate-spin", label: "执行中" },
  WAITING: { icon: Hourglass, cls: "text-amber-500", label: "挂起中" },
  SUCCESS: { icon: CheckCircle2, cls: "text-emerald-500", label: "成功" },
  FAILED: { icon: XCircle, cls: "text-rose-500", label: "失败" },
  SKIPPED: { icon: CircleDot, cls: "text-muted-foreground/50", label: "跳过" },
}

function JsonBlock({ label, raw }: { label: string; raw?: string }) {
  if (!raw) return null
  let pretty = raw
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    /* 非 JSON 原样展示 */
  }
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">{label}</div>
      <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-1.5 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all">{pretty}</pre>
    </div>
  )
}

/* ---------------- Agent steps 明细（§9.1） ---------------- */

interface AgentStep {
  tool: string
  args?: Record<string, unknown>
  result?: string
}

/** 从节点 output JSON 提取 agent steps（无则 null，走普通 JSON 展示） */
function parseAgentSteps(output?: string): AgentStep[] | null {
  if (!output) return null
  try {
    const obj = JSON.parse(output) as { steps?: unknown }
    if (Array.isArray(obj.steps) && obj.steps.length > 0) return obj.steps as AgentStep[]
    return null
  } catch {
    return null
  }
}

function AgentSteps({ steps }: { steps: AgentStep[] }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium text-muted-foreground">Agent 工具调用（{steps.length} 步）</div>
      {steps.map((s, i) => (
        <div key={i} className="rounded border bg-muted/20 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="flex size-4 items-center justify-center rounded bg-violet-600/15 text-[9px] font-semibold text-violet-600 dark:text-violet-400">
              {i + 1}
            </span>
            <Wrench className="size-3 text-violet-500" />
            <span className="font-mono font-medium">{s.tool}</span>
          </div>
          {s.args && (
            <div className="mt-1 font-mono text-[10px] text-muted-foreground break-all">args: {JSON.stringify(s.args)}</div>
          )}
          {s.result != null && (
            <div className="mt-0.5 font-mono text-[10px] text-foreground/80 break-all">→ {String(s.result).slice(0, 300)}</div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ---------------- WAITING 恢复回调条（§9.2） ---------------- */

export function WaitingResumeBar({ resumeToken }: { resumeToken?: string }) {
  if (!resumeToken) return null
  const url = `/api/orch/resume/${resumeToken}`
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
      <Hourglass className="size-4 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-amber-600 dark:text-amber-400">流水挂起中，等待回调恢复</div>
        <code className="block truncate font-mono text-[11px] text-muted-foreground">POST {url}</code>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 gap-1 text-xs"
        onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${url}`).then(() => toast.success("恢复地址已复制"))}
      >
        <Copy className="size-3" /> 复制
      </Button>
    </div>
  )
}

/* ---------------- 节点时间线 ---------------- */

export function ExecNodeTimeline({ nodes }: { nodes: OrchExecNode[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  if (nodes.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">暂无节点留痕</div>
  }
  return (
    <div className="space-y-1">
      {nodes.map((n) => {
        const meta = NODE_STATUS[n.status]
        const open = openId === n.nodeId
        const hasDetail = !!(n.input || n.output || n.error)
        const steps = open ? parseAgentSteps(n.output) : null
        return (
          <div key={n.nodeId} className="rounded-md border">
            <button
              type="button"
              onClick={() => hasDetail && setOpenId(open ? null : n.nodeId)}
              className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left", hasDetail && "hover:bg-accent/50")}
            >
              <meta.icon className={cn("size-4 shrink-0", meta.cls)} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{n.nodeName}</span>
              {n.costMs != null && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{n.costMs}ms</span>}
              <span className={cn("shrink-0 text-[10px]", meta.cls.replace(" animate-spin", ""))}>{meta.label}</span>
              {hasDetail && (open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />)}
            </button>
            {open && (
              <div className="space-y-1.5 border-t px-2.5 py-2">
                {n.error && (
                  <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-[11px] text-rose-600 dark:text-rose-400">{n.error}</div>
                )}
                <JsonBlock label="输入" raw={n.input} />
                {steps ? <AgentSteps steps={steps} /> : <JsonBlock label="输出" raw={n.output} />}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ExecStatusBadge({ status }: { status: OrchExecStatus }) {
  const meta = EXEC_STATUS_META[status]
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  )
}
