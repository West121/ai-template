import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { Hand, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuthStore } from "@/stores/auth-store"
import { wfFormatTime, wfInstancePath, type WfTaskItem } from "@/types/workflow"

/** 待办列表（我的审批「待办」Tab 内容）；onCount 上报待办总数供徽标 / 小红点 */
export function TodoList({ onCount }: { onCount?: (n: number) => void }) {
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)
  const [rows, setRows] = useState<WfTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [claimingId, setClaimingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<WfTaskItem>>("/api/wf/tasks/todo?pageNum=1&pageSize=100")
      setRows(page.list)
      onCount?.(page.total)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [onCount])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline, activeAssignmentId])

  const claim = useCallback(
    async (task: WfTaskItem) => {
      setClaimingId(task.taskId)
      try {
        await api(`/api/wf/tasks/${task.taskId}/claim`, { method: "POST" })
        toast.success("已认领")
        void load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "认领失败")
      } finally {
        setClaimingId(null)
      }
    },
    [load],
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
                navigate(wfInstancePath(row.original))
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
          searchKeys={["instanceTitle", "defName", "initiatorName"]}
          searchPlaceholder="搜索标题 / 流程 / 发起人"
          onRowClick={(row) => navigate(wfInstancePath(row))}
          onRefresh={() => void load()}
          exportFileName="我的待办"
        />
      )}
    </div>
  )
}
