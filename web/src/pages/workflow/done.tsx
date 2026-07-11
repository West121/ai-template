import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { ShieldAlert } from "lucide-react"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
// 直接从纯函数模块引入，避免把 TipTap 编辑器拉进列表分片（index 会带出 editor）
import { stripHtml } from "@/components/rich-text/strip-html"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { wfFormatTime, wfInstancePath, type WfDoneItem } from "@/types/workflow"
import { useDebounced, useServerPage } from "@/lib/use-server-page"

const ACTION_META: Record<string, { label: string; className: string }> = {
  APPROVE: { label: "同意", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  REJECT: { label: "驳回", className: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
}

/** 已办列表（我的审批「已办」Tab 内容） */
export function DoneList() {
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState("")
  const query = useDebounced(keyword.trim())
  // 服务端分页 + 服务端搜索（keyword=标题/流程名模糊）
  const page = useServerPage<WfDoneItem>(
    (pageNum, pageSize) =>
      `/api/wf/instances/done-by-me?pageNum=${pageNum}&pageSize=${pageSize}${query ? `&keyword=${encodeURIComponent(query)}` : ""}`,
    { resetKey: query },
  )
  const { rows, loading, loadError, reload } = page

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
            {/* 意见升级富文本后列内展示纯文本摘要（存量纯文本幂等） */}
            {stripHtml(row.original.comment, 50) || "—"}
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
          searchKeys={["instanceTitle", "defName", "nodeName"]}
          searchPlaceholder="搜索标题 / 流程"
          serverSearch={{ keyword, onKeywordChange: setKeyword }}
          onRowClick={(row) => navigate(wfInstancePath(row))}
          onRefresh={reload}
          exportFileName="我的已办"
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
