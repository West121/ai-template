import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Eye, MailCheck, MailOpen, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import { useBadgeStore } from "@/stores/badge-store"
import {
  BackendDownCard,
  StatusBadge,
  formatOrderNo,
  formatTime,
  typeLabel,
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

/** 抄送行：审批单 + 已读标记（契约 GET /api/office/approvals/cc） */
interface CcRow extends ApprovalRow {
  readFlag: boolean
}

export default function ApprovalCcPage() {
  const [rows, setRows] = useState<CcRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [viewRow, setViewRow] = useState<CcRow | null>(null)

  const offline = useAuthStore((s) => s.offline)
  const setBadge = useBadgeStore((s) => s.setBadge)

  const unreadCount = rows.filter((row) => !row.readFlag).length

  const syncBadge = useCallback(
    (list: CcRow[]) => {
      const unread = list.filter((row) => !row.readFlag).length
      setBadge("/approval/cc", unread > 0 ? unread : undefined)
    },
    [setBadge],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<CcRow>>("/api/office/approvals/cc?pageNum=1&pageSize=100")
      setRows(page.list)
      syncBadge(page.list)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [syncBadge])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  /** 本地置读并同步徽标 */
  const markReadLocal = useCallback(
    (id: number) => {
      setRows((prev) => {
        const next = prev.map((row) => (row.id === id ? { ...row, readFlag: true } : row))
        syncBadge(next)
        return next
      })
    },
    [syncBadge],
  )

  const markRead = useCallback(
    async (row: CcRow, withToast: boolean) => {
      if (row.readFlag) return
      markReadLocal(row.id)
      try {
        await api(`/api/office/approvals/cc/${row.id}/read`, { method: "POST" })
        if (withToast) toast.success(`已将「${row.title}」标记为已读`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "标记已读失败")
      }
    },
    [markReadLocal],
  )

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) {
      toast.info("没有未读的抄送")
      return
    }
    try {
      await api("/api/office/approvals/cc/read-all", { method: "POST" })
      setRows((prev) => {
        const next = prev.map((row) => ({ ...row, readFlag: true }))
        syncBadge(next)
        return next
      })
      toast.success(`已将 ${unreadCount} 条抄送全部标记为已读`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    }
  }

  const handleView = useCallback(
    (row: CcRow) => {
      void markRead(row, false)
      setViewRow(row)
    },
    [markRead],
  )

  const columns = useMemo<ColumnDef<CcRow, unknown>[]>(
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
        cell: ({ row }) => (
          <span className={cn("flex items-center gap-2", !row.original.readFlag && "font-semibold")}>
            {!row.original.readFlag && <span className="size-2 shrink-0 rounded-full bg-blue-500" />}
            {row.original.title}
          </span>
        ),
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
        accessorKey: "status",
        meta: { title: "单据状态" },
        header: () => <span>单据状态</span>,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "createdAt",
        meta: { title: "发起时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="发起时间" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{formatTime(row.original.createdAt)}</span>
        ),
      },
      {
        accessorKey: "readFlag",
        meta: { title: "是否已读" },
        header: () => <span>是否已读</span>,
        cell: ({ row }) =>
          row.original.readFlag ? (
            <Badge variant="outline" className="text-muted-foreground">
              已读
            </Badge>
          ) : (
            <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
              未读
            </Badge>
          ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => handleView(row.original)}>
              <Eye className="size-3.5" />
              查看
            </Button>
            {!row.original.readFlag && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-blue-600 hover:text-blue-700"
                onClick={() => void markRead(row.original, true)}
              >
                <MailOpen className="size-3.5" />
                标记已读
              </Button>
            )}
          </div>
        ),
      },
    ],
    [markRead, handleView],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="抄送我的"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为抄送给您的真实审批单据"
            : `共 ${rows.length} 条抄送，${unreadCount} 条未读`
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
          exportFileName="抄送我的"
          actionSlot={
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void handleMarkAllRead()}>
              <MailCheck className="size-3.5" />
              全部已读
            </Button>
          }
        />
      )}

      <Dialog open={viewRow !== null} onOpenChange={(open) => !open && setViewRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{viewRow?.title}</DialogTitle>
            <DialogDescription>
              单号 {viewRow ? formatOrderNo(viewRow.id) : ""} · {typeLabel(viewRow?.type)} · 发起于{" "}
              {formatTime(viewRow?.createdAt)}
            </DialogDescription>
          </DialogHeader>
          {viewRow && (
            <div className="space-y-2.5 py-1 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <div>
                  <span className="text-muted-foreground">申请人：</span>
                  {viewRow.applicant}
                </div>
                <div>
                  <span className="text-muted-foreground">所属部门：</span>
                  {viewRow.deptName ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">单据状态：</span>
                  <StatusBadge status={viewRow.status} />
                </div>
                {(viewRow.startDate || viewRow.endDate) && (
                  <div>
                    <span className="text-muted-foreground">起止日期：</span>
                    {viewRow.startDate ?? "—"} 至 {viewRow.endDate ?? "—"}
                  </div>
                )}
              </div>
              <div>
                <div className="text-muted-foreground">申请事由：</div>
                <div className="mt-1 rounded bg-muted/60 px-3 py-2">{viewRow.reason ?? "—"}</div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
