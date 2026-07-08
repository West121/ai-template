import { useEffect, useState } from "react"
import { CloudOff, RotateCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/** 审批单通用行结构（契约 Approval 响应） */
export interface ApprovalRow {
  id: number
  title: string
  type: string
  applicant: string
  applicantId?: number
  deptId?: number
  deptName?: string
  status: string
  reason?: string
  startDate?: string
  endDate?: string
  createdAt?: string
}

/** 审批类型枚举 → 中文 */
export const TYPE_LABEL: Record<string, string> = {
  LEAVE: "请假",
  EXPENSE: "报销",
  TRIP: "出差",
  OVERTIME: "加班",
  SEAL: "用章",
  PURCHASE: "采购",
  CONTRACT: "合同",
  OTHER: "其他",
}

export function typeLabel(type?: string) {
  return (type && TYPE_LABEL[type]) ?? type ?? "—"
}

/** 状态枚举 → 中文 + 徽章配色 */
export const STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: { label: "审批中", className: "border-blue-500/30 bg-blue-500/10 text-blue-600" },
  APPROVED: { label: "已通过", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  REJECTED: { label: "已驳回", className: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
  WITHDRAWN: { label: "已撤销", className: "border-gray-500/30 bg-gray-500/10 text-gray-500" },
}

export function statusLabel(status?: string) {
  return (status && STATUS_META[status]?.label) ?? status ?? "—"
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status]
  return (
    <Badge variant="outline" className={meta?.className}>
      {meta?.label ?? status}
    </Badge>
  )
}

export function formatTime(iso?: string) {
  if (!iso) return "—"
  return iso.slice(0, 16).replace("T", " ")
}

export function formatOrderNo(id: number) {
  return `SP${String(id).padStart(4, "0")}`
}

/** 后端未启动兜底卡片（与 pending.tsx 同款） */
export function BackendDownCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <CloudOff className="size-5 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium">后端服务未启动</div>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，
          然后用 admin / manager / zhangsan（密码 admin123）重新登录，即可体验真实数据。
        </p>
        <Button size="sm" className="gap-1.5" onClick={onRetry}>
          <RotateCw className="size-3.5" /> 重试连接
        </Button>
      </CardContent>
    </Card>
  )
}

/** 审批日志（契约 GET /api/office/approvals/{id}/logs） */
export interface ApprovalLog {
  action: "CREATE" | "APPROVE" | "REJECT" | "WITHDRAW" | string
  actorName: string
  comment?: string
  createdAt?: string
}

const LOG_META: Record<string, { label: string; dot: string }> = {
  CREATE: { label: "发起申请", dot: "bg-blue-500" },
  APPROVE: { label: "同意", dot: "bg-emerald-500" },
  REJECT: { label: "驳回", dot: "bg-rose-500" },
  WITHDRAW: { label: "撤销申请", dot: "bg-gray-400" },
}

/** 竖向审批日志时间线 */
export function LogTimeline({ logs, loading }: { logs: ApprovalLog[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="mt-1 size-[11px] shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (logs.length === 0) {
    return <div className="py-2 text-xs text-muted-foreground">暂无流转记录</div>
  }
  return (
    <div className="space-y-0">
      {logs.map((log, index) => {
        const meta = LOG_META[log.action] ?? { label: log.action, dot: "bg-muted-foreground/30" }
        return (
          <div key={index} className="relative flex gap-3 pb-6 last:pb-0">
            {index < logs.length - 1 && <div className="absolute left-[5px] top-4 h-full w-px bg-border" />}
            <div className={cn("mt-1 size-[11px] shrink-0 rounded-full", meta.dot)} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{meta.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {log.actorName} · {formatTime(log.createdAt)}
              </div>
              {log.comment && <div className="mt-1 rounded bg-muted/60 px-2 py-1 text-xs">{log.comment}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 按需拉取审批日志的 Hook：approvalId 为 null 时不请求 */
export function useApprovalLogs(approvalId: number | null) {
  const [logs, setLogs] = useState<ApprovalLog[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (approvalId == null) {
      setLogs([])
      return
    }
    let canceled = false
    setLoading(true)
    api<ApprovalLog[]>(`/api/office/approvals/${approvalId}/logs`)
      .then((data) => {
        if (!canceled) setLogs(data)
      })
      .catch(() => {
        if (!canceled) setLogs([])
      })
      .finally(() => {
        if (!canceled) setLoading(false)
      })
    return () => {
      canceled = true
    }
  }, [approvalId])

  return { logs, loading }
}
