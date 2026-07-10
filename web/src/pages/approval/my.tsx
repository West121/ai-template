import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Eye, ShieldAlert, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, ApiError, NetworkError, type PageResult } from "@/lib/api"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export default function ApprovalMyPage() {
  const [rows, setRows] = useState<ApprovalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState("all")
  const [viewRow, setViewRow] = useState<ApprovalRow | null>(null)
  const [revokeRow, setRevokeRow] = useState<ApprovalRow | null>(null)

  const offline = useAuthStore((s) => s.offline)
  const { logs, loading: logsLoading } = useApprovalLogs(viewRow?.id ?? null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const statusParam = statusFilter === "all" ? "" : `status=${statusFilter}&`
      const page = await api<PageResult<ApprovalRow>>(
        `/api/office/approvals/my?${statusParam}pageNum=1&pageSize=100`,
      )
      setRows(page.list)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  const handleRevoke = async () => {
    if (!revokeRow) return
    try {
      await api(`/api/office/approvals/${revokeRow.id}/withdraw`, { method: "POST" })
      toast.success(`申请「${revokeRow.title}」已撤销`)
      setRevokeRow(null)
      void load()
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message)
      else toast.error(err instanceof Error ? err.message : "撤销失败")
    }
  }

  const columns = useMemo<ColumnDef<ApprovalRow, unknown>[]>(
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
        accessorKey: "reason",
        meta: { title: "事由" },
        header: () => <span>事由</span>,
        cell: ({ row }) => (
          <span className="block max-w-52 truncate text-muted-foreground">{row.original.reason ?? "—"}</span>
        ),
      },
      {
        accessorKey: "status",
        meta: { title: "状态" },
        header: () => <span>状态</span>,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "createdAt",
        meta: { title: "提交时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="提交时间" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{formatTime(row.original.createdAt)}</span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setViewRow(row.original)}>
              <Eye className="size-3.5" />
              查看
            </Button>
            {row.original.status === "PENDING" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-rose-600"
                onClick={() => setRevokeRow(row.original)}
              >
                <Undo2 className="size-3.5" />
                撤销
              </Button>
            )}
          </div>
        ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="我的申请"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为本人发起的真实审批单据"
            : "查看本人发起的全部审批单据及流转进度"
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
          searchKeys={["title", "reason"]}
          searchPlaceholder="搜索标题 / 事由…"
          exportFileName="我的申请"
          filterSlot={
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger size="sm" className="h-8 w-32 text-sm">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="PENDING">审批中</SelectItem>
                <SelectItem value="APPROVED">已通过</SelectItem>
                <SelectItem value="REJECTED">已驳回</SelectItem>
                <SelectItem value="WITHDRAWN">已撤销</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      )}

      {/* 查看详情 */}
      <Dialog open={viewRow !== null} onOpenChange={(open) => !open && setViewRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{viewRow?.title}</DialogTitle>
            <DialogDescription>
              单号 {viewRow ? formatOrderNo(viewRow.id) : ""} · {typeLabel(viewRow?.type)} · 提交于{" "}
              {formatTime(viewRow?.createdAt)}
            </DialogDescription>
          </DialogHeader>
          {viewRow && (
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                <div>
                  <span className="text-muted-foreground">状态：</span>
                  <StatusBadge status={viewRow.status} />
                </div>
                <div>
                  <span className="text-muted-foreground">所属部门：</span>
                  {viewRow.deptName ?? "—"}
                </div>
                {(viewRow.startDate || viewRow.endDate) && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">起止日期：</span>
                    {viewRow.startDate ?? "—"} 至 {viewRow.endDate ?? "—"}
                  </div>
                )}
                <div className="col-span-2">
                  <div className="text-muted-foreground">事由：</div>
                  <div className="mt-1 rounded bg-muted/60 px-3 py-2">{viewRow.reason ?? "—"}</div>
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

      {/* 撤销确认 */}
      <Dialog open={revokeRow !== null} onOpenChange={(open) => !open && setRevokeRow(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>确认撤销申请</DialogTitle>
            <DialogDescription>
              撤销后单据 {revokeRow ? formatOrderNo(revokeRow.id) : ""}（{revokeRow?.title}）将终止流转，如需重新申请请再次发起。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeRow(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void handleRevoke()}>
              确认撤销
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
