import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import {
  AlarmClockOff,
  CalendarCheck2,
  CircleAlert,
  CloudOff,
  Fingerprint,
  LogOut,
  RotateCw,
  ShieldAlert,
  Timer,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

type AttendanceStatus = "NORMAL" | "LATE" | "EARLY" | "ABSENT" | "REST"

interface AttendanceRow {
  date: string
  week: string
  checkIn?: string
  checkOut?: string
  hours?: number
  status: AttendanceStatus
}

interface AttendanceSummary {
  days: number
  late: number
  early: number
  absent: number
  overtimeHours: number
}

interface RecordsData {
  summary: AttendanceSummary
  list: AttendanceRow[]
}

const statusText: Record<AttendanceStatus, string> = {
  NORMAL: "正常",
  LATE: "迟到",
  EARLY: "早退",
  ABSENT: "缺卡",
  REST: "休息日",
}

const statusBadgeClass: Record<AttendanceStatus, string> = {
  NORMAL: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  LATE: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  EARLY: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  ABSENT: "border-rose-500/30 bg-rose-500/10 text-rose-600",
  REST: "border-slate-500/30 bg-slate-500/10 text-slate-500",
}

const STATUS_OPTIONS: AttendanceStatus[] = ["NORMAL", "LATE", "EARLY", "ABSENT", "REST"]

function TimeCell({ value, status }: { value?: string; status: AttendanceStatus }) {
  if (!value) {
    return (
      <span
        className={cn(
          "tabular-nums",
          status === "REST" ? "text-muted-foreground" : "font-medium text-rose-500",
        )}
      >
        —
      </span>
    )
  }
  return <span className="tabular-nums">{value}</span>
}

const columns: ColumnDef<AttendanceRow, unknown>[] = [
  {
    accessorKey: "date",
    meta: { title: "日期" },
    header: ({ column }) => <DataTableColumnHeader column={column} title="日期" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.date}</span>,
  },
  {
    accessorKey: "week",
    meta: { title: "星期" },
    header: () => <span>星期</span>,
    cell: ({ row }) => row.original.week,
  },
  {
    accessorKey: "checkIn",
    meta: { title: "上班打卡" },
    header: () => <span>上班打卡</span>,
    cell: ({ row }) => <TimeCell value={row.original.checkIn} status={row.original.status} />,
  },
  {
    accessorKey: "checkOut",
    meta: { title: "下班打卡" },
    header: () => <span>下班打卡</span>,
    cell: ({ row }) => <TimeCell value={row.original.checkOut} status={row.original.status} />,
  },
  {
    accessorKey: "hours",
    meta: { title: "工时" },
    header: ({ column }) => <DataTableColumnHeader column={column} title="工时" />,
    cell: ({ row }) => (
      <span className={cn("tabular-nums", row.original.hours == null && "text-muted-foreground")}>
        {row.original.hours != null ? `${row.original.hours}h` : "—"}
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
]

export default function AttendanceRecordPage() {
  const [data, setData] = useState<RecordsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [statusFilter, setStatusFilter] = useState("all")

  const offline = useAuthStore((s) => s.offline)
  const monthKey = useMemo(() => format(new Date(), "yyyy-MM"), [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api<RecordsData>(`/api/office/attendance/records?month=${monthKey}`)
      setData(res)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [monthKey])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  const handleCheck = useCallback(async () => {
    setChecking(true)
    try {
      const rec = await api<AttendanceRow>("/api/office/attendance/check", { method: "POST" })
      toast.success(
        rec.checkOut ? `签退成功（${rec.checkOut}）` : `签到成功（${rec.checkIn ?? ""}）`,
      )
      await load()
    } catch (err) {
      if (err instanceof NetworkError) toast.error("无法连接后端服务")
      else toast.error(err instanceof Error ? err.message : "打卡失败")
    } finally {
      setChecking(false)
    }
  }, [load])

  const rows = data?.list ?? []
  const filtered = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter],
  )

  const stats = [
    { label: "出勤天数", value: `${data?.summary.days ?? 0} 天`, icon: CalendarCheck2, iconClass: "bg-emerald-500/10 text-emerald-600" },
    { label: "迟到", value: `${data?.summary.late ?? 0} 次`, icon: AlarmClockOff, iconClass: "bg-amber-500/10 text-amber-600" },
    { label: "早退", value: `${data?.summary.early ?? 0} 次`, icon: LogOut, iconClass: "bg-sky-500/10 text-sky-600" },
    { label: "缺卡", value: `${data?.summary.absent ?? 0} 次`, icon: CircleAlert, iconClass: "bg-rose-500/10 text-rose-600" },
    { label: "加班时长", value: `${data?.summary.overtimeHours ?? 0} 小时`, icon: Timer, iconClass: "bg-violet-500/10 text-violet-600" },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="打卡记录"
        description={`本月（${monthKey}）的出勤明细`}
        actions={
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={checking || loadError === "network"}
            onClick={() => void handleCheck()}
          >
            <Fingerprint className="size-4" />
            {checking ? "打卡中…" : "打卡"}
          </Button>
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
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot
              spring-boot:run，然后重新登录即可查看本月真实打卡记录并体验一键打卡。
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
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {stats.map((s) => (
              <Card key={s.label} className="flex-row items-center gap-3 px-5 py-4">
                <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", s.iconClass)}>
                  <s.icon className="size-5" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums">{s.value}</div>
                </div>
              </Card>
            ))}
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            searchKeys={["date", "week"]}
            searchPlaceholder="搜索日期…"
            exportFileName="打卡记录"
            initialPageSize={20}
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
          />
        </>
      )}
    </div>
  )
}
