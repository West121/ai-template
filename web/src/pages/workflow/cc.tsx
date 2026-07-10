import { useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { wfFormatTime, wfInstancePath, type WfCcItem } from "@/types/workflow"
import { useServerPage } from "./use-server-page"

/**
 * 待阅列表（我的审批「待阅」Tab 内容）。
 * 服务端分页后未读总数不再从当前页推（只会算到一页），改由父级（tasks.tsx）预取维护；
 * 本组件在打开未读项时经 `onRead` 通知父级递减小红点。
 */
export function CcList({ onRead }: { onRead?: () => void }) {
  const navigate = useNavigate()
  const page = useServerPage<WfCcItem>(
    (pageNum, pageSize) => `/api/wf/instances/cc?pageNum=${pageNum}&pageSize=${pageSize}`,
  )
  const { rows, loading, loadError, reload } = page

  /** 打开详情即记已读（后端 GET /instances/{id} 会自动标记 wf_cc 已读；未读数由父级递减） */
  const open = useCallback(
    (row: WfCcItem) => {
      if (!row.readFlag) onRead?.()
      navigate(wfInstancePath({ procInstId: row.procInstId }))
    },
    [navigate, onRead],
  )

  const columns = useMemo<ColumnDef<WfCcItem, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {!row.original.readFlag && <span className="size-1.5 shrink-0 rounded-full bg-destructive" />}
            <span className={cn("font-medium", row.original.readFlag && "text-muted-foreground")}>
              {row.original.title ?? row.original.instanceTitle ?? "—"}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "defName",
        meta: { title: "流程" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="流程" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.defName ?? "—"}</Badge>,
      },
      {
        accessorKey: "initiatorName",
        meta: { title: "发起人" },
        header: () => <span>发起人</span>,
        cell: ({ row }) => row.original.initiatorName ?? "—",
      },
      {
        id: "readFlag",
        meta: { title: "状态" },
        header: () => <span>状态</span>,
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
        accessorKey: "createdAt",
        meta: { title: "抄送时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="抄送时间" />,
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
          searchKeys={["title", "defName", "initiatorName"]}
          searchPlaceholder="搜索当前页标题 / 流程 / 发起人"
          onRowClick={open}
          onRefresh={reload}
          exportFileName="抄送我的"
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
