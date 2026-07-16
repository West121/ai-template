import { useCallback, useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { fetchMineFieldPerms, filterColumnsByMine, type MineFieldPerms } from "@/lib/field-perms"
import { differenceInCalendarDays } from "date-fns"
import { CloudOff, Plus, RotateCw, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { Progress } from "@/components/ui/progress"
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
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

type LeaveType = "ANNUAL" | "PERSONAL" | "SICK" | "COMP"
type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN"

interface LeaveRow {
  id: number
  type: LeaveType
  startDate: string
  endDate: string
  days: number
  reason: string
  status: LeaveStatus
  applicant?: string
  deptName?: string
  createdAt?: string
}

interface LeaveQuota {
  type: LeaveType
  total: number
  used: number
}

const typeText: Record<LeaveType, string> = {
  ANNUAL: "年假",
  PERSONAL: "事假",
  SICK: "病假",
  COMP: "调休",
}

const statusText: Record<LeaveStatus, string> = {
  PENDING: "待审批",
  APPROVED: "已通过",
  REJECTED: "已驳回",
  WITHDRAWN: "已撤销",
}

const statusBadgeClass: Record<LeaveStatus, string> = {
  PENDING: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  APPROVED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  REJECTED: "border-rose-500/30 bg-rose-500/10 text-rose-600",
  WITHDRAWN: "border-slate-500/30 bg-slate-500/10 text-slate-500",
}

const quotaBarClass: Record<LeaveType, string> = {
  ANNUAL: "text-blue-600",
  PERSONAL: "text-amber-600",
  SICK: "text-emerald-600",
  COMP: "text-violet-600",
}

const LEAVE_TYPES: LeaveType[] = ["ANNUAL", "PERSONAL", "SICK", "COMP"]
const STATUS_OPTIONS: LeaveStatus[] = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]

function leaveNo(id: number) {
  return `QJ${String(id).padStart(4, "0")}`
}

function formatTime(iso?: string) {
  if (!iso) return "—"
  return iso.slice(0, 16).replace("T", " ")
}

export default function AttendanceLeavePage() {
  const [rows, setRows] = useState<LeaveRow[]>([])
  // 角色级字段权限（P3）：@FieldPerm 固定列（事由/时长等）按 mine 隐藏整列
  const [mineFieldPerms, setMineFieldPerms] = useState<MineFieldPerms>({})
  useEffect(() => {
    let alive = true
    void fetchMineFieldPerms("ATTENDANCE_LEAVE").then((m) => {
      if (alive) setMineFieldPerms(m)
    })
    return () => {
      alive = false
    }
  }, [])
  const [quotas, setQuotas] = useState<LeaveQuota[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState("all")
  const [applyOpen, setApplyOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [detailRow, setDetailRow] = useState<LeaveRow | null>(null)
  const [revokeRow, setRevokeRow] = useState<LeaveRow | null>(null)
  const [form, setForm] = useState({ type: "", startDate: "", endDate: "", reason: "" })

  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [quotaList, page] = await Promise.all([
        api<LeaveQuota[]>("/api/office/leaves/quotas"),
        api<PageResult<LeaveRow>>("/api/office/leaves?pageNum=1&pageSize=100"),
      ])
      setQuotas(quotaList)
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

  const filtered = statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)

  async function handleSubmit() {
    if (!form.type || !form.startDate || !form.endDate || !form.reason.trim()) {
      toast.error("请填写完整的请假信息")
      return
    }
    const days = differenceInCalendarDays(new Date(form.endDate), new Date(form.startDate)) + 1
    if (days <= 0) {
      toast.error("结束日期不能早于开始日期")
      return
    }
    setSubmitting(true)
    try {
      await api("/api/office/leaves", {
        method: "POST",
        body: JSON.stringify({
          type: form.type,
          startDate: form.startDate,
          endDate: form.endDate,
          days,
          reason: form.reason.trim(),
        }),
      })
      setApplyOpen(false)
      setForm({ type: "", startDate: "", endDate: "", reason: "" })
      toast.success("请假申请已提交，等待审批")
      await load()
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
      await api(`/api/office/leaves/${revokeRow.id}/withdraw`, { method: "POST" })
      toast.success(`请假申请 ${leaveNo(revokeRow.id)} 已撤销`)
      setRevokeRow(null)
      await load()
    } catch (err) {
      if (err instanceof NetworkError) toast.error("无法连接后端服务")
      else toast.error(err instanceof Error ? err.message : "撤销失败")
    }
  }

  const allColumns: ColumnDef<LeaveRow, unknown>[] = [
    {
      accessorKey: "id",
      meta: { title: "单号" },
      header: () => <span>单号</span>,
      cell: ({ row }) => <span className="font-mono text-xs">{leaveNo(row.original.id)}</span>,
    },
    {
      accessorKey: "type",
      meta: { title: "类型" },
      header: () => <span>类型</span>,
      cell: ({ row }) => <Badge variant="secondary">{typeText[row.original.type]}</Badge>,
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
      accessorKey: "days",
      meta: { title: "时长（天）" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="时长（天）" />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.days} 天</span>,
    },
    {
      accessorKey: "reason",
      meta: { title: "事由" },
      header: () => <span>事由</span>,
      cell: ({ row }) => (
        <span className="block max-w-56 truncate text-muted-foreground" title={row.original.reason}>
          {row.original.reason}
        </span>
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

  // 角色级字段权限：mine.visible=false 的列整列隐藏（示范接入；后端脱敏为权威）
  const columns = filterColumnsByMine(allColumns, mineFieldPerms)

  if (loadError === "network") {
    return (
      <div className="space-y-4">
        <PageHeader title="请假管理" description="后端未连接——启动 server/ 后此页为真实数据" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot
              spring-boot:run，然后重新登录即可查看真实假期额度与请假记录。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void load()}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <PageHeader title="请假管理" description="查看假期余额，提交与管理请假申请" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title="请假管理" description="查看假期余额，提交与管理请假申请" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {quotas.map((q) => (
          <Card key={q.type} className="gap-3 px-5 py-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">{typeText[q.type]}</span>
              <span className="text-xs text-muted-foreground">
                已用 <span className={`font-semibold ${quotaBarClass[q.type]}`}>{q.used}</span> / 共{" "}
                {q.total} 天
              </span>
            </div>
            <Progress value={q.total > 0 ? (q.used / q.total) * 100 : 0} />
            <div className="text-xs text-muted-foreground">剩余 {q.total - q.used} 天</div>
          </Card>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        searchKeys={["reason", "startDate"]}
        searchPlaceholder="搜索事由 / 日期…"
        exportFileName="请假记录"
        onRefresh={() => void load()}
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
            申请请假
          </Button>
        }
      />

      {/* 申请请假 */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>申请请假</DialogTitle>
            <DialogDescription>提交后将进入审批流程，审批人：部门负责人</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>请假类型</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="请选择类型" />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {typeText[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="leave-start">开始日期</Label>
                <Input
                  id="leave-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="leave-end">结束日期</Label>
                <Input
                  id="leave-end"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leave-reason">请假事由</Label>
              <Textarea
                id="leave-reason"
                rows={3}
                placeholder="请简要说明请假原因…"
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
            <DialogTitle>请假详情</DialogTitle>
            <DialogDescription>单号 {detailRow ? leaveNo(detailRow.id) : ""}</DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">请假类型</span>
                <Badge variant="secondary">{typeText[detailRow.type]}</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">请假时间</span>
                <span className="tabular-nums">
                  {detailRow.startDate} 至 {detailRow.endDate}（{detailRow.days} 天）
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
                <span className="text-muted-foreground">提交时间</span>
                <span className="tabular-nums">{formatTime(detailRow.createdAt)}</span>
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
                <span className="text-muted-foreground">请假事由</span>
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
              确定要撤销请假申请 {revokeRow ? leaveNo(revokeRow.id) : ""}{" "}
              吗？撤销后该申请将不再进入审批流程，如需请假请重新提交。
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
