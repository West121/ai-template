/**
 * 执行记录呈现：节点时间线（状态/耗时/输入输出 JSON 展开/错误）——测试运行抽屉与执行记录详情共用。
 */
import { useState } from "react"
import { CheckCircle2, ChevronDown, ChevronRight, CircleDot, Loader2, XCircle, type LucideProps } from "lucide-react"
import type { ComponentType } from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { OrchExecNode, OrchExecStatus } from "./mock"

export const EXEC_STATUS_META: Record<OrchExecStatus, { label: string; className: string }> = {
  RUNNING: { label: "执行中", className: "border-blue-500/30 bg-blue-500/10 text-blue-600" },
  SUCCESS: { label: "成功", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  FAILED: { label: "失败", className: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
  CANCELED: { label: "已取消", className: "text-muted-foreground" },
}

const NODE_STATUS: Record<OrchExecNode["status"], { icon: ComponentType<LucideProps>; cls: string; label: string }> = {
  RUNNING: { icon: Loader2, cls: "text-blue-500 animate-spin", label: "执行中" },
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
                <JsonBlock label="输出" raw={n.output} />
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
