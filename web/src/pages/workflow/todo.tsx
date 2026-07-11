import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { Hand, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { wfFormatTime, wfInstancePath, type WfTaskItem } from "@/types/workflow"
import { useServerPage } from "@/lib/use-server-page"

/** 待办列表（我的审批「待办」Tab 内容）；onCount 上报待办总数供徽标 / 小红点 */
export function TodoList({ onCount }: { onCount?: (n: number) => void }) {
  const navigate = useNavigate()
  const [claimingId, setClaimingId] = useState<string | null>(null)

  // 服务端分页：徽标用响应 total（不受当前页影响）
  const page = useServerPage<WfTaskItem>(
    (pageNum, pageSize) => `/api/wf/tasks/todo?pageNum=${pageNum}&pageSize=${pageSize}`,
    { onPage: (p) => onCount?.(p.total) },
  )
  const { rows, loading, loadError, reload } = page

  const claim = useCallback(
    async (task: WfTaskItem) => {
      setClaimingId(task.taskId)
      try {
        await api(`/api/wf/tasks/${task.taskId}/claim`, { method: "POST" })
        toast.success("已认领")
        reload()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "认领失败")
      } finally {
        setClaimingId(null)
      }
    },
    [reload],
  )

  const columns = useMemo<ColumnDef<WfTaskItem, unknown>[]>(
    () => [
      {
        accessorKey: "instanceTitle",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => <span className="font-medium">{row.original.instanceTitle}</span>,
      },
      {
        accessorKey: "defName",
        meta: { title: "流程" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="流程" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.defName}</Badge>,
      },
      {
        accessorKey: "nodeName",
        meta: { title: "当前节点" },
        header: () => <span>当前节点</span>,
        cell: ({ row }) => (
          <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
            {row.original.nodeName}
          </Badge>
        ),
      },
      {
        accessorKey: "initiatorName",
        meta: { title: "发起人" },
        header: () => <span>发起人</span>,
        cell: ({ row }) => row.original.initiatorName,
      },
      {
        accessorKey: "createdAt",
        meta: { title: "到达时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="到达时间" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{wfFormatTime(row.original.createdAt)}</span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) =>
          row.original.groupClaim ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
              disabled={claimingId === row.original.taskId}
              onClick={(e) => {
                e.stopPropagation()
                void claim(row.original)
              }}
            >
              <Hand className="size-3.5" /> {claimingId === row.original.taskId ? "认领中…" : "认领"}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-primary hover:text-primary"
              onClick={(e) => {
                e.stopPropagation()
                navigate(row.original.viewPath ?? wfInstancePath(row.original))
              }}
            >
              去处理
            </Button>
          ),
      },
    ],
    [navigate, claim, claimingId],
  )

  return (
    <div className="space-y-4">
      {loadError === "network" ? (
        <BackendDownCard onRetry={reload} />
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={reload}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          searchKeys={["instanceTitle", "defName", "initiatorName"]}
          searchPlaceholder="搜索当前页标题 / 流程 / 发起人"
          onRowClick={(row) => navigate(row.viewPath ?? wfInstancePath(row))}
          onRefresh={reload}
          exportFileName="我的待办"
          serverPagination={{
            pageIndex: page.pageIndex,
            pageSize: page.pageSize,
            rowCount: page.total,
            onPaginationChange: page.onPaginationChange,
          }}
        />
      )}
    </div>
  )
}
