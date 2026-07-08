import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuthStore } from "@/stores/auth-store"
import { wfFormatTime, wfInstancePath, type WfCcItem } from "@/types/workflow"

/** 待阅列表（我的审批「待阅」Tab 内容）；onUnread 上报未读数供小红点 */
export function CcList({ onUnread }: { onUnread?: (n: number) => void }) {
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const [rows, setRows] = useState<WfCcItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<WfCcItem>>("/api/wf/instances/cc?pageNum=1&pageSize=100")
      setRows(page.list)
      onUnread?.(page.list.filter((r) => !r.readFlag).length)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [onUnread])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  /** 打开详情即记已读（后端 GET /instances/{id} 会自动标记 wf_cc 已读，这里仅乐观更新本地状态） */
  const open = useCallback(
    (row: WfCcItem) => {
      if (!row.readFlag) {
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, readFlag: true } : r)))
      }
      navigate(wfInstancePath({ procInstId: row.procInstId }))
    },
    [navigate],
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
          searchKeys={["title", "defName", "initiatorName"]}
          searchPlaceholder="搜索标题 / 流程 / 发起人"
          onRowClick={open}
          onRefresh={() => void load()}
          exportFileName="抄送我的"
        />
      )}
    </div>
  )
}
