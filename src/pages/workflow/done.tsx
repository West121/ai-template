import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { ShieldAlert } from "lucide-react"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuthStore } from "@/stores/auth-store"
import { wfFormatTime, wfInstancePath, type WfDoneItem } from "@/types/workflow"

const ACTION_META: Record<string, { label: string; className: string }> = {
  APPROVE: { label: "同意", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  REJECT: { label: "驳回", className: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
}

/** 已办列表（我的审批「已办」Tab 内容） */
export function DoneList() {
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)
  const [rows, setRows] = useState<WfDoneItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<WfDoneItem>>("/api/wf/instances/done-by-me?pageNum=1&pageSize=100")
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
  }, [load, offline, activeAssignmentId])

  const columns = useMemo<ColumnDef<WfDoneItem, unknown>[]>(
    () => [
      {
        accessorKey: "instanceTitle",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.instanceTitle ?? row.original.title ?? "—"}</span>
        ),
      },
      {
        accessorKey: "defName",
        meta: { title: "流程" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="流程" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.defName ?? "—"}</Badge>,
      },
      {
        accessorKey: "nodeName",
        meta: { title: "处理节点" },
        header: () => <span>处理节点</span>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.nodeName ?? "—"}</span>
        ),
      },
      {
        accessorKey: "action",
        meta: { title: "处理结果" },
        header: () => <span>处理结果</span>,
        cell: ({ row }) => {
          const action = row.original.action
          if (!action) return <span className="text-sm text-muted-foreground">—</span>
          const meta = ACTION_META[action]
          return (
            <Badge variant="outline" className={meta?.className}>
              {meta?.label ?? action}
            </Badge>
          )
        },
      },
      {
        accessorKey: "comment",
        meta: { title: "审批意见" },
        header: () => <span>审批意见</span>,
        cell: ({ row }) => (
          <span className="line-clamp-1 max-w-52 text-sm text-muted-foreground">
            {row.original.comment || "—"}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        meta: { title: "处理时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="处理时间" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{wfFormatTime(row.original.createdAt)}</span>
        ),
      },
    ],
    [],
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
          searchKeys={["instanceTitle", "defName", "nodeName"]}
          searchPlaceholder="搜索标题 / 流程"
          onRowClick={(row) => navigate(wfInstancePath(row))}
          onRefresh={() => void load()}
          exportFileName="我的已办"
        />
      )}
    </div>
  )
}
