import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import type { ColumnDef } from "@tanstack/react-table"
import { ShieldAlert, SquarePen, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { Modal } from "@/components/modal"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { WF_STATUS_META, wfFormatTime, wfInstancePath, type WfMyInstance } from "@/types/workflow"
import { useDebounced, useServerPage } from "@/lib/use-server-page"

/** 我发起的列表（我的审批「我发起」Tab 内容） */
export function MineList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [canceling, setCanceling] = useState<WfMyInstance | null>(null)
  const [cancelSubmitting, setCancelSubmitting] = useState(false)

  const [keyword, setKeyword] = useState("")
  const query = useDebounced(keyword.trim())
  // 服务端分页 + 服务端搜索（keyword=标题/流程名模糊）
  const page = useServerPage<WfMyInstance>(
    (pageNum, pageSize) =>
      `/api/wf/instances/my?pageNum=${pageNum}&pageSize=${pageSize}${query ? `&keyword=${encodeURIComponent(query)}` : ""}`,
    { resetKey: query },
  )
  const { rows, loading, loadError, reload } = page

  const cancel = useCallback(async () => {
    if (!canceling) return
    setCancelSubmitting(true)
    try {
      await api(`/api/wf/instances/${canceling.id}/cancel`, { method: "POST" })
      toast.success(t("「{{title}}」已撤销", { title: canceling.title }))
      setCanceling(null)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("撤销失败"))
    } finally {
      setCancelSubmitting(false)
    }
  }, [canceling, reload, t])

  const columns = useMemo<ColumnDef<WfMyInstance, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        meta: { title: t("标题") },
        header: () => <span>{t("标题")}</span>,
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      },
      {
        accessorKey: "defName",
        meta: { title: t("流程") },
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("流程")} />,
        cell: ({ row }) => <Badge variant="outline">{row.original.defName ?? "—"}</Badge>,
      },
      {
        accessorKey: "bizStatus",
        meta: { title: t("状态") },
        header: () => <span>{t("状态")}</span>,
        cell: ({ row }) => {
          const meta = WF_STATUS_META[row.original.bizStatus]
          return (
            <Badge variant="outline" className={meta?.className}>
              {meta?.label ? t(meta.label) : row.original.bizStatus}
            </Badge>
          )
        },
      },
      {
        id: "currentNodes",
        meta: { title: t("当前节点") },
        header: () => <span>{t("当前节点")}</span>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.currentNodeNames?.length ? row.original.currentNodeNames.join("、") : "—"}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        meta: { title: t("发起时间") },
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("发起时间")} />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{wfFormatTime(row.original.createdAt)}</span>
        ),
      },
      {
        accessorKey: "endedAt",
        meta: { title: t("结束时间") },
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("结束时间")} />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{wfFormatTime(row.original.endedAt)}</span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>{t("操作")}</span>,
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
              <Undo2 className="size-3.5" /> {t("撤销")}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    [t],
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => navigate("/workflow/start")}>
          <SquarePen className="size-3.5" /> {t("发起申请")}
        </Button>
      </div>

      {loadError === "network" ? (
        <BackendDownCard onRetry={reload} />
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={reload}>
              {t("重试")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          searchKeys={["title", "defName"]}
          searchPlaceholder={t("搜索标题 / 流程")}
          serverSearch={{ keyword, onKeywordChange: setKeyword }}
          onRowClick={(row) => navigate(wfInstancePath(row))}
          onRefresh={reload}
          exportFileName={t("我发起的")}
          serverPagination={{
            pageIndex: page.pageIndex,
            pageSize: page.pageSize,
            rowCount: page.total,
            onPaginationChange: page.onPaginationChange,
          }}
        />
      )}

      {/* 撤销确认 */}
      <Modal
        open={!!canceling}
        onOpenChange={(open) => !open && !cancelSubmitting && setCanceling(null)}
        title={t("撤销流程")}
        description={canceling?.title}
        width={420}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setCanceling(null)} disabled={cancelSubmitting}>
              {t("取消")}
            </Button>
            <Button variant="destructive" onClick={() => void cancel()} disabled={cancelSubmitting}>
              {cancelSubmitting ? t("撤销中…") : t("确认撤销")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {t("撤销后流程立即终止，状态记为「已撤销」。确定要撤销这条申请吗？")}
        </p>
      </Modal>
    </div>
  )
}
