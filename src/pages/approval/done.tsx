import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Eye, ShieldAlert } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import {
  BackendDownCard,
  LogTimeline,
  StatusBadge,
  formatOrderNo,
  formatTime,
  typeLabel,
  useApprovalLogs,
  type ApprovalRow,
} from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** 已办事项行：审批单 + 我的操作与处理时间（契约 GET /api/office/approvals/done） */
interface DoneRow extends ApprovalRow {
  myAction: "APPROVE" | "REJECT" | string
  actedAt?: string
}

function ActionBadge({ action }: { action: string }) {
  return action === "APPROVE" ? (
    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
      同意
    </Badge>
  ) : (
    <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600">
      驳回
    </Badge>
  )
}

export default function ApprovalDonePage() {
  const [rows, setRows] = useState<DoneRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<DoneRow | null>(null)

  const offline = useAuthStore((s) => s.offline)
  const { logs, loading: logsLoading } = useApprovalLogs(detailRow?.id ?? null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<DoneRow>>("/api/office/approvals/done?pageNum=1&pageSize=100")
      setRows(page.list)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  const columns = useMemo<ColumnDef<DoneRow, unknown>[]>(
    () => [
      {
        accessorKey: "id",
        meta: { title: "单号" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="单号" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{formatOrderNo(row.original.id)}</span>
        ),
      },
      {
        accessorKey: "title",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      },
      {
        accessorKey: "type",
        meta: { title: "类型" },
        header: () => <span>类型</span>,
        cell: ({ row }) => <Badge variant="secondary">{typeLabel(row.original.type)}</Badge>,
      },
      {
        accessorKey: "applicant",
        meta: { title: "申请人" },
        header: () => <span>申请人</span>,
        cell: ({ row }) => <span>{row.original.applicant}</span>,
      },
      {
        accessorKey: "myAction",
        meta: { title: "我的操作" },
        header: () => <span>我的操作</span>,
        cell: ({ row }) => <ActionBadge action={row.original.myAction} />,
      },
      {
        accessorKey: "actedAt",
        meta: { title: "处理时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="处理时间" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{formatTime(row.original.actedAt)}</span>
        ),
      },
      {
        accessorKey: "status",
        meta: { title: "当前状态" },
        header: () => <span>当前状态</span>,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setDetailRow(row.original)}>
            <Eye className="size-3.5" />
            详情
          </Button>
        ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="已办事项"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为您处理过的真实审批记录"
            : "您已处理的审批记录及单据当前状态"
        }
      />

      {loadError === "network" ? (
        <BackendDownCard onRetry={() => void load()} />
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          onRefresh={() => void load()}
          searchKeys={["title", "applicant"]}
          searchPlaceholder="搜索标题 / 申请人…"
          exportFileName="已办事项"
        />
      )}

      <Dialog open={detailRow !== null} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{detailRow?.title}</DialogTitle>
            <DialogDescription>单号 {detailRow ? formatOrderNo(detailRow.id) : ""}</DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                <div>
                  <span className="text-muted-foreground">类型：</span>
                  {typeLabel(detailRow.type)}
                </div>
                <div>
                  <span className="text-muted-foreground">申请人：</span>
                  {detailRow.applicant}
                </div>
                <div>
                  <span className="text-muted-foreground">我的操作：</span>
                  <ActionBadge action={detailRow.myAction} />
                </div>
                <div>
                  <span className="text-muted-foreground">当前状态：</span>
                  <StatusBadge status={detailRow.status} />
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">处理时间：</span>
                  {formatTime(detailRow.actedAt)}
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">事由：</div>
                  <div className="mt-1 rounded bg-muted/60 px-3 py-2">{detailRow.reason ?? "—"}</div>
                </div>
              </div>
              <div>
                <div className="mb-3 text-sm font-medium">审批流程</div>
                <LogTimeline logs={logs} loading={logsLoading} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
