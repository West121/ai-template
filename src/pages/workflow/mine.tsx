import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { ShieldAlert, SquarePen, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { Modal } from "@/components/modal"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuthStore } from "@/stores/auth-store"
import { WF_STATUS_META, wfFormatTime, wfInstancePath, type WfMyInstance } from "@/types/workflow"

/** 我发起的列表（我的审批「我发起」Tab 内容） */
export function MineList() {
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const [rows, setRows] = useState<WfMyInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [canceling, setCanceling] = useState<WfMyInstance | null>(null)
  const [cancelSubmitting, setCancelSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<WfMyInstance>>("/api/wf/instances/my?pageNum=1&pageSize=100")
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

  const cancel = useCallback(async () => {
    if (!canceling) return
    setCancelSubmitting(true)
    try {
      await api(`/api/wf/instances/${canceling.id}/cancel`, { method: "POST" })
      toast.success(`「${canceling.title}」已撤销`)
      setCanceling(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "撤销失败")
    } finally {
      setCancelSubmitting(false)
    }
  }, [canceling, load])

  const columns = useMemo<ColumnDef<WfMyInstance, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      },
      {
        accessorKey: "defName",
        meta: { title: "流程" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="流程" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.defName ?? "—"}</Badge>,
      },
      {
        accessorKey: "bizStatus",
        meta: { title: "状态" },
        header: () => <span>状态</span>,
        cell: ({ row }) => {
          const meta = WF_STATUS_META[row.original.bizStatus]
          return (
            <Badge variant="outline" className={meta?.className}>
              {meta?.label ?? row.original.bizStatus}
            </Badge>
          )
        },
      },
      {
        id: "currentNodes",
        meta: { title: "当前节点" },
        header: () => <span>当前节点</span>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.currentNodeNames?.length ? row.original.currentNodeNames.join("、") : "—"}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        meta: { title: "发起时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="发起时间" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{wfFormatTime(row.original.createdAt)}</span>
        ),
      },
      {
        accessorKey: "endedAt",
        meta: { title: "结束时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="结束时间" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{wfFormatTime(row.original.endedAt)}</span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) =>
          row.original.canCancel ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600"
              onClick={(e) => {
                e.stopPropagation()
                setCanceling(row.original)
              }}
            >
              <Undo2 className="size-3.5" /> 撤销
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => navigate("/workflow/start")}>
          <SquarePen className="size-3.5" /> 发起申请
        </Button>
      </div>

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
          searchKeys={["title", "defName"]}
          searchPlaceholder="搜索标题 / 流程"
          onRowClick={(row) => navigate(wfInstancePath(row))}
          onRefresh={() => void load()}
          exportFileName="我发起的"
        />
      )}

      {/* 撤销确认 */}
      <Modal
        open={!!canceling}
        onOpenChange={(open) => !open && !cancelSubmitting && setCanceling(null)}
        title="撤销流程"
        description={canceling?.title}
        width={420}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setCanceling(null)} disabled={cancelSubmitting}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void cancel()} disabled={cancelSubmitting}>
              {cancelSubmitting ? "撤销中…" : "确认撤销"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          撤销后流程立即终止，状态记为「已撤销」。确定要撤销这条申请吗？
        </p>
      </Modal>
    </div>
  )
}
