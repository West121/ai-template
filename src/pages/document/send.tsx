import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Button } from "@/components/ui/button"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import { fetchDocList } from "./gongwen/mock"
import { gwFormatDate, type GwDoc } from "./gongwen/types"
import { DocTypeBadge, GwStatusBadge, SecretBadge, UrgencyBadge } from "./gongwen/badges"
import { DraftFormDialog } from "./gongwen/draft-form"
import { DemoBanner, EMPTY_FILTER, GwFilterBar, toListQuery, type GwFilterState } from "./gongwen/shared"

export default function SendPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<GwDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [filter, setFilter] = useState<GwFilterState>(EMPTY_FILTER)
  const [createOpen, setCreateOpen] = useState(false)

  const [searchParams, setSearchParams] = useSearchParams()

  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)
  const canDraft = useHasPerm("office:doc:send")

  // 从「发起申请」跳转（formSubmitPath=/document/send?new=1）：自动打开拟稿弹窗并清掉 query，避免刷新/返回重复弹
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setCreateOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete("new")
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const load = useCallback(async () => {
    setLoading(true)
    setErrMsg(null)
    try {
      const res = await fetchDocList(toListQuery("SEND", filter))
      setRows(res.data)
      setDemo(res.demo)
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load, offline, activeAssignmentId])

  const columns = useMemo<ColumnDef<GwDoc, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        meta: { title: "文号" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="文号" />,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>,
      },
      {
        accessorKey: "title",
        meta: { title: "标题" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="标题" />,
        cell: ({ row }) => (
          <span className="block max-w-72 truncate font-medium" title={row.original.title}>
            {row.original.title}
          </span>
        ),
      },
      {
        accessorKey: "docType",
        meta: { title: "文种" },
        header: () => <span>文种</span>,
        cell: ({ row }) => <DocTypeBadge docType={row.original.docType} />,
      },
      {
        accessorKey: "secret",
        meta: { title: "密级" },
        header: () => <span>密级</span>,
        cell: ({ row }) => <SecretBadge secret={row.original.secret} />,
      },
      {
        accessorKey: "urgency",
        meta: { title: "缓急" },
        header: () => <span>缓急</span>,
        cell: ({ row }) => <UrgencyBadge urgency={row.original.urgency} />,
      },
      {
        accessorKey: "drafter",
        meta: { title: "拟稿人" },
        header: () => <span>拟稿人</span>,
        cell: ({ row }) => <span>{row.original.drafter ?? "—"}</span>,
      },
      {
        accessorKey: "status",
        meta: { title: "状态" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => <GwStatusBadge direction="SEND" status={row.original.status} />,
      },
      {
        accessorKey: "docDate",
        meta: { title: "成文日期" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="成文日期" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{gwFormatDate(row.original.docDate)}</span>
        ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader title="发文管理" description="发文拟稿、核稿、签发、用印、成文分发全流程办文（GB/T 9704）" />

      {demo && <DemoBanner />}

      <DataTable
        columns={columns}
        data={rows}
        searchKeys={["code", "title"]}
        searchPlaceholder="搜索文号 / 标题"
        loading={loading}
        onRefresh={() => void load()}
        exportFileName="发文台账"
        onRowClick={(row) => navigate(`/document/send/${row.id}`)}
        filterSlot={<GwFilterBar direction="SEND" value={filter} onChange={setFilter} />}
        actionSlot={
          canDraft ? (
            <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              新建发文
            </Button>
          ) : undefined
        }
      />

      {errMsg && <div className="text-center text-sm text-rose-500">{errMsg}</div>}

      <DraftFormDialog
        direction="SEND"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(doc) => navigate(`/document/send/${doc.id}`)}
      />
    </div>
  )
}
