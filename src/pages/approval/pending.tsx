import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CircleCheck, CircleX, CloudOff, Eye, RotateCw, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Modal } from "@/components/modal"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, ApiError, NetworkError, type PageResult } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import { useBadgeStore } from "@/stores/badge-store"

interface ApprovalRow {
  id: number
  title: string
  type: string
  applicant: string
  applicantId?: number
  deptId?: number
  deptName?: string
  status: string
  reason?: string
  createdAt?: string
}

function formatTime(iso?: string) {
  if (!iso) return "—"
  return iso.slice(0, 16).replace("T", " ")
}

export default function ApprovalPendingPage() {
  const [rows, setRows] = useState<ApprovalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ApprovalRow | null>(null)
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)
  const canApprove = useHasPerm("office:approval:approve")
  const setBadge = useBadgeStore((s) => s.setBadge)

  const refreshBadge = useCallback(
    (count: number) => {
      setBadge("/approval", count)
      setBadge("/approval/pending", count)
    },
    [setBadge],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<ApprovalRow>>(
        "/api/office/approvals?status=PENDING&pageNum=1&pageSize=100",
      )
      setRows(page.list)
      refreshBadge(page.total)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [refreshBadge])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    // 切换身份后数据权限变化，重新拉取
    void load()
  }, [load, offline, activeAssignmentId])

  const act = useCallback(
    async (row: ApprovalRow, action: "approve" | "reject", reason?: string) => {
      try {
        await api(`/api/office/approvals/${row.id}/${action}`, {
          method: "POST",
          body: reason ? JSON.stringify({ reason }) : undefined,
        })
        toast.success(`「${row.title}」已${action === "approve" ? "通过" : "驳回"}`)
        setRows((prev) => {
          const next = prev.filter((r) => r.id !== row.id)
          refreshBadge(next.length)
          return next
        })
      } catch (err) {
        if (err instanceof ApiError && err.code === 403) {
          toast.error("没有审批权限（office:approval:approve）")
        } else {
          toast.error(err instanceof Error ? err.message : "操作失败")
        }
      }
    },
    [refreshBadge],
  )

  const columns = useMemo<ColumnDef<ApprovalRow, unknown>[]>(
    () => [
      {
        accessorKey: "id",
        meta: { title: "单号" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="单号" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            SP{String(row.original.id).padStart(4, "0")}
          </span>
        ),
      },
      {
        accessorKey: "title",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      },
      {
        accessorKey: "type",
        meta: { title: "类型" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="类型" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge>,
      },
      {
        accessorKey: "applicant",
        meta: { title: "申请人" },
        header: () => <span>申请人</span>,
        cell: ({ row }) => row.original.applicant,
      },
      {
        accessorKey: "deptName",
        meta: { title: "所属部门" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="所属部门" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.deptName ?? (row.original.deptId != null ? `部门 #${row.original.deptId}` : "—")}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        meta: { title: "提交时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="提交时间" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatTime(row.original.createdAt)}</span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!canApprove}
                    className="h-7 gap-1 px-2 text-xs text-emerald-600 hover:text-emerald-600"
                    onClick={() => void act(row.original, "approve")}
                  >
                    <CircleCheck className="size-3.5" /> 同意
                  </Button>
                </span>
              </TooltipTrigger>
              {!canApprove && <TooltipContent>无审批权限（角色未授予 office:approval:approve）</TooltipContent>}
            </Tooltip>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canApprove}
              className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600"
              onClick={() => {
                setRejecting(row.original)
                setRejectReason("")
              }}
            >
              <CircleX className="size-3.5" /> 驳回
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setDetail(row.original)}>
              <Eye className="size-3.5" /> 详情
            </Button>
          </div>
        ),
      },
    ],
    [canApprove, act],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="待我审批"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据（随身份/数据权限变化）"
            : `共 ${rows.length} 件待办 · 已按当前身份的数据权限过滤，切换身份（右上角头像菜单）可见范围随之变化`
        }
      />

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，
              然后用 admin / manager / zhangsan（密码 admin123）重新登录，即可体验按数据权限过滤的真实待办与兼任身份切换。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void load()}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
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
          searchKeys={["title", "applicant", "type"]}
          searchPlaceholder="搜索标题 / 申请人"
          enableSelection={canApprove}
          batchSlot={(selected, clear) => (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs text-emerald-600 hover:text-emerald-600"
              onClick={() => {
                void (async () => {
                  for (const row of selected) {
                    await act(row, "approve")
                  }
                  clear()
                })()
              }}
            >
              <CircleCheck className="size-3.5" />
              批量同意
            </Button>
          )}
          onRefresh={() => void load()}
          exportFileName="待我审批"
        />
      )}

      {/* 详情 */}
      <Modal
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.title ?? "审批详情"}
        description={detail ? `SP${String(detail.id).padStart(4, "0")} · ${detail.type}` : undefined}
        width={480}
        footer={
          <Button variant="outline" onClick={() => setDetail(null)}>
            关闭
          </Button>
        }
      >
        {detail && (
          <div className="space-y-3 text-sm">
            {[
              ["申请人", detail.applicant],
              ["所属部门", detail.deptName ?? `部门 #${detail.deptId ?? "—"}`],
              ["提交时间", formatTime(detail.createdAt)],
              ["状态", detail.status],
              ["事由", detail.reason ?? "—"],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-3">
                <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
                <span className="min-w-0 flex-1">{value}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 驳回 */}
      <Modal
        open={!!rejecting}
        onOpenChange={(open) => !open && setRejecting(null)}
        title="驳回申请"
        description={rejecting?.title}
        width={440}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim()}
              onClick={() => {
                if (rejecting) void act(rejecting, "reject", rejectReason.trim())
                setRejecting(null)
              }}
            >
              确认驳回
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <Label className="text-xs">
            <span className="text-destructive">*</span> 驳回意见
          </Label>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="请填写驳回原因"
            rows={3}
          />
        </div>
      </Modal>
    </div>
  )
}
