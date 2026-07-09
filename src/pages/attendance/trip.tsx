import { useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/page-header"
import { OfflineFallback } from "@/components/offline-fallback"
import { ErrorState } from "@/components/error-state"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { useApiData } from "@/hooks/use-api-data"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

type Transport = "TRAIN" | "FLIGHT" | "CAR"
type TripStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN"

interface TripRow {
  id: number
  destination: string
  startDate: string
  endDate: string
  transport: Transport
  budget: number
  reason: string
  status: TripStatus
  applicant?: string
  deptName?: string
  createdAt?: string
}

const transportText: Record<Transport, string> = {
  TRAIN: "高铁",
  FLIGHT: "飞机",
  CAR: "自驾",
}

const statusText: Record<TripStatus, string> = {
  PENDING: "待审批",
  APPROVED: "已通过",
  REJECTED: "已驳回",
  WITHDRAWN: "已撤销",
}

const statusBadgeClass: Record<TripStatus, string> = {
  PENDING: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  APPROVED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  REJECTED: "border-rose-500/30 bg-rose-500/10 text-rose-600",
  WITHDRAWN: "border-slate-500/30 bg-slate-500/10 text-slate-500",
}

const TRANSPORTS: Transport[] = ["TRAIN", "FLIGHT", "CAR"]
const STATUS_OPTIONS: TripStatus[] = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]

function tripNo(id: number) {
  return `CC${String(id).padStart(4, "0")}`
}

export default function AttendanceTripPage() {
  const [statusFilter, setStatusFilter] = useState("all")
  const [applyOpen, setApplyOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [detailRow, setDetailRow] = useState<TripRow | null>(null)
  const [revokeRow, setRevokeRow] = useState<TripRow | null>(null)
  const [form, setForm] = useState({
    destination: "",
    startDate: "",
    endDate: "",
    transport: "",
    budget: "",
    reason: "",
  })

  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)

  const { data, loading, error, offline, reload } = useApiData<PageResult<TripRow>>(
    () => api<PageResult<TripRow>>("/api/office/trips?pageNum=1&pageSize=100"),
    [activeAssignmentId],
  )
  const rows = data?.list ?? []

  const filtered = statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)

  async function handleSubmit() {
    if (
      !form.destination.trim() ||
      !form.startDate ||
      !form.endDate ||
      !form.transport ||
      !form.budget ||
      !form.reason.trim()
    ) {
      toast.error("请填写完整的出差信息")
      return
    }
    if (form.endDate < form.startDate) {
      toast.error("结束日期不能早于开始日期")
      return
    }
    setSubmitting(true)
    try {
      await api("/api/office/trips", {
        method: "POST",
        body: JSON.stringify({
          destination: form.destination.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          transport: form.transport,
          budget: Number(form.budget),
          reason: form.reason.trim(),
        }),
      })
      setApplyOpen(false)
      setForm({ destination: "", startDate: "", endDate: "", transport: "", budget: "", reason: "" })
      toast.success("出差申请已提交，等待审批")
      reload()
    } catch (err) {
      if (err instanceof NetworkError) toast.error("无法连接后端服务")
      else toast.error(err instanceof Error ? err.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke() {
    if (!revokeRow) return
    try {
      await api(`/api/office/trips/${revokeRow.id}/withdraw`, { method: "POST" })
      toast.success(`出差申请 ${tripNo(revokeRow.id)} 已撤销`)
      setRevokeRow(null)
      reload()
    } catch (err) {
      if (err instanceof NetworkError) toast.error("无法连接后端服务")
      else toast.error(err instanceof Error ? err.message : "撤销失败")
    }
  }

  const columns: ColumnDef<TripRow, unknown>[] = [
    {
      accessorKey: "id",
      meta: { title: "单号" },
      header: () => <span>单号</span>,
      cell: ({ row }) => <span className="font-mono text-xs">{tripNo(row.original.id)}</span>,
    },
    {
      accessorKey: "destination",
      meta: { title: "目的地" },
      header: () => <span>目的地</span>,
      cell: ({ row }) => <span className="font-medium">{row.original.destination}</span>,
    },
    {
      accessorKey: "reason",
      meta: { title: "事由" },
      header: () => <span>事由</span>,
      cell: ({ row }) => (
        <span className="block max-w-52 truncate text-muted-foreground" title={row.original.reason}>
          {row.original.reason}
        </span>
      ),
    },
    {
      accessorKey: "startDate",
      meta: { title: "开始日期" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="开始日期" />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.startDate}</span>,
    },
    {
      accessorKey: "endDate",
      meta: { title: "结束日期" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="结束日期" />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.endDate}</span>,
    },
    {
      accessorKey: "transport",
      meta: { title: "交通工具" },
      header: () => <span>交通工具</span>,
      cell: ({ row }) => <Badge variant="secondary">{transportText[row.original.transport]}</Badge>,
    },
    {
      accessorKey: "budget",
      meta: { title: "预算" },
      header: ({ column }) => (
        <div className="flex justify-end">
          <DataTableColumnHeader column={column} title="预算" />
        </div>
      ),
      cell: ({ row }) => (
        <div className="text-right font-medium tabular-nums">
          ¥{row.original.budget.toLocaleString("zh-CN")}
        </div>
      ),
    },
    {
      accessorKey: "status",
      meta: { title: "状态" },
      header: () => <span>状态</span>,
      cell: ({ row }) => (
        <Badge variant="outline" className={statusBadgeClass[row.original.status]}>
          {statusText[row.original.status]}
        </Badge>
      ),
    },
    {
      id: "actions",
      enableSorting: false,
      enableHiding: false,
      header: () => <span>操作</span>,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setDetailRow(row.original)}>
            详情
          </Button>
          {row.original.status === "PENDING" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-rose-500 hover:text-rose-600"
              onClick={() => setRevokeRow(row.original)}
            >
              撤销
            </Button>
          )}
        </div>
      ),
    },
  ]

  if (offline) {
    return (
      <div className="space-y-4">
        <PageHeader title="出差管理" description="后端未连接——启动 server/ 后此页为真实数据" />
        <OfflineFallback
          description="此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，然后重新登录即可提交与管理真实出差申请。"
          onRetry={reload}
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="出差管理" description="提交出差申请，跟踪审批进度与差旅预算" />
        <ErrorState message={error} onRetry={reload} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title="出差管理" description="提交出差申请，跟踪审批进度与差旅预算" />

      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        searchKeys={["destination", "reason"]}
        searchPlaceholder="搜索目的地 / 事由…"
        exportFileName="出差记录"
        onRefresh={reload}
        filterSlot={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger size="sm" className="h-8 w-32 text-sm">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusText[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        actionSlot={
          <Button size="sm" className="h-8" onClick={() => setApplyOpen(true)}>
            <Plus className="size-4" />
            申请出差
          </Button>
        }
      />

      {/* 申请出差 */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>申请出差</DialogTitle>
            <DialogDescription>请填写出差计划，审批通过后可预订差旅</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="trip-dest">目的地</Label>
              <Input
                id="trip-dest"
                placeholder="如：上海"
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="trip-start">开始日期</Label>
                <Input
                  id="trip-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="trip-end">结束日期</Label>
                <Input
                  id="trip-end"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>交通工具</Label>
                <Select value={form.transport} onValueChange={(v) => setForm({ ...form, transport: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSPORTS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {transportText[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="trip-budget">预算（元）</Label>
                <Input
                  id="trip-budget"
                  type="number"
                  min={0}
                  placeholder="如：3500"
                  value={form.budget}
                  onChange={(e) => setForm({ ...form, budget: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="trip-reason">出差事由</Label>
              <Textarea
                id="trip-reason"
                rows={3}
                placeholder="请简要说明出差目的…"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)}>
              取消
            </Button>
            <Button disabled={submitting} onClick={() => void handleSubmit()}>
              {submitting ? "提交中…" : "提交申请"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 详情 */}
      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>出差详情</DialogTitle>
            <DialogDescription>单号 {detailRow ? tripNo(detailRow.id) : ""}</DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">目的地</span>
                <span className="font-medium">{detailRow.destination}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">出差时间</span>
                <span className="tabular-nums">
                  {detailRow.startDate} 至 {detailRow.endDate}
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">交通工具</span>
                <Badge variant="secondary">{transportText[detailRow.transport]}</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">差旅预算</span>
                <span className="font-medium tabular-nums">
                  ¥{detailRow.budget.toLocaleString("zh-CN")}
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">申请人</span>
                <span>
                  {detailRow.applicant ?? "—"}
                  {detailRow.deptName ? `（${detailRow.deptName}）` : ""}
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">当前状态</span>
                <Badge variant="outline" className={statusBadgeClass[detailRow.status]}>
                  {statusText[detailRow.status]}
                </Badge>
              </div>
              <Separator />
              <div className="space-y-1.5">
                <span className="text-muted-foreground">出差事由</span>
                <p className="rounded-md bg-muted/50 p-3 leading-relaxed">{detailRow.reason}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailRow(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 撤销确认 */}
      <Dialog open={!!revokeRow} onOpenChange={(open) => !open && setRevokeRow(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>撤销申请</DialogTitle>
            <DialogDescription>
              确定要撤销出差申请 {revokeRow ? tripNo(revokeRow.id) : ""}（{revokeRow?.destination}
              ）吗？撤销后该申请将不再进入审批流程。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeRow(null)}>
              再想想
            </Button>
            <Button variant="destructive" onClick={() => void handleRevoke()}>
              确认撤销
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
