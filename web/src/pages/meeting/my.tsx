import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"
import { CalendarDays, CalendarRange, CloudOff, RotateCw, ShieldAlert, UserRound } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, NetworkError, type PageResult } from "@/lib/api"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuthStore } from "@/stores/auth-store"

/** 后端「我的会议」响应 */
interface MeetingRow {
  id: number
  subject: string
  roomName: string
  organizer: string
  organizerId?: number
  date: string
  startHour: number
  endHour: number
  status: string // UPCOMING | ONGOING | FINISHED | CANCELED
  role: string // HOST | ATTENDEE
}

function formatDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function RoleBadge({ role }: { role: string }) {
  if (role === "HOST") {
    return (
      <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
        主持人
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      参会人
    </Badge>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === "UPCOMING") {
    return (
      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
        待开始
      </Badge>
    )
  }
  if (status === "ONGOING") {
    return (
      <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
        进行中
      </Badge>
    )
  }
  if (status === "FINISHED") {
    return (
      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
        已结束
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      已取消
    </Badge>
  )
}

export default function MyMeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState("all")

  // 取消确认对话框
  const [cancelMeeting, setCancelMeeting] = useState<MeetingRow | null>(null)

  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)

  const todayStr = useMemo(() => formatDate(new Date()), [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<MeetingRow>>(
        "/api/office/meetings/my?pageNum=1&pageSize=100",
      )
      setMeetings(page.list)
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

  const filteredMeetings = useMemo(
    () => (statusFilter === "all" ? meetings : meetings.filter((m) => m.status === statusFilter)),
    [meetings, statusFilter],
  )

  const stats = useMemo(() => {
    const todayList = meetings.filter((m) => m.date === todayStr)
    const ongoing = todayList.filter((m) => m.status === "ONGOING").length
    const upcoming = meetings.filter((m) => m.status === "UPCOMING")
    const hosted = meetings.filter((m) => m.role === "HOST")
    const hostedUpcoming = hosted.filter((m) => m.status === "UPCOMING").length
    return [
      { label: "今日会议", value: `${todayList.length} 场`, icon: CalendarDays, hint: `含进行中 ${ongoing} 场` },
      { label: "待开始", value: `${upcoming.length} 场`, icon: CalendarRange, hint: "按当前列表统计" },
      { label: "我主持的", value: `${hosted.length} 场`, icon: UserRound, hint: `待开始 ${hostedUpcoming} 场` },
    ]
  }, [meetings, todayStr])

  const confirmCancel = async () => {
    if (!cancelMeeting) return
    try {
      await api(`/api/office/meetings/${cancelMeeting.id}/cancel`, { method: "POST" })
      setMeetings((prev) =>
        prev.map((m) => (m.id === cancelMeeting.id ? { ...m, status: "CANCELED" } : m)),
      )
      toast.success(`已取消会议「${cancelMeeting.subject}」，将通知全部参会人`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "取消失败")
    } finally {
      setCancelMeeting(null)
    }
  }

  const columns = useMemo<ColumnDef<MeetingRow, unknown>[]>(
    () => [
      {
        accessorKey: "subject",
        meta: { title: "会议主题" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="会议主题" />,
        cell: ({ row }) => (
          <span className="block max-w-60 truncate font-medium" title={row.original.subject}>
            {row.original.subject}
          </span>
        ),
      },
      {
        accessorKey: "roomName",
        meta: { title: "会议室" },
        header: () => <span>会议室</span>,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.roomName}</span>,
      },
      {
        accessorKey: "organizer",
        meta: { title: "发起人" },
        header: () => <span>发起人</span>,
        cell: ({ row }) => <span>{row.original.organizer}</span>,
      },
      {
        accessorKey: "date",
        meta: { title: "会议时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="会议时间" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.date} {row.original.startHour}:00-{row.original.endHour}:00
          </span>
        ),
      },
      {
        id: "duration",
        meta: { title: "时长" },
        header: () => <span>时长</span>,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.endHour - row.original.startHour} 小时
          </span>
        ),
      },
      {
        accessorKey: "role",
        meta: { title: "我的角色" },
        header: () => <span>我的角色</span>,
        cell: ({ row }) => <RoleBadge role={row.original.role} />,
      },
      {
        accessorKey: "status",
        meta: { title: "状态" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => {
          const meeting = row.original
          return (
            <div className="flex items-center gap-1">
              {meeting.status === "ONGOING" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-primary"
                  onClick={() => toast.success(`正在进入会议「${meeting.subject}」…`)}
                >
                  进入会议
                </Button>
              )}
              {meeting.status === "UPCOMING" && meeting.role === "HOST" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-rose-600 hover:text-rose-600"
                  onClick={() => setCancelMeeting(meeting)}
                >
                  取消会议
                </Button>
              )}
            </div>
          )
        },
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="我的会议"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : "查看我参与和发起的会议安排与状态"
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
              spring-boot:run，然后重新登录，即可查看我参与/主持的真实会议并在线取消。
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
          <div className="grid gap-4 sm:grid-cols-3">
            {stats.map((stat) => (
              <Card key={stat.label} className="py-4">
                <CardContent className="flex items-center gap-3 px-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <stat.icon className="size-5" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                    <div className="text-lg font-semibold">{stat.value}</div>
                  </div>
                  <span className="ml-auto text-xs text-muted-foreground">{stat.hint}</span>
                </CardContent>
              </Card>
            ))}
          </div>

          <DataTable
            columns={columns}
            data={filteredMeetings}
            searchKeys={["subject"]}
            searchPlaceholder="搜索会议主题"
            loading={loading}
            onRefresh={() => void load()}
            exportFileName="我的会议"
            filterSlot={
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger size="sm" className="h-8 w-32 text-sm">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="UPCOMING">待开始</SelectItem>
                  <SelectItem value="ONGOING">进行中</SelectItem>
                  <SelectItem value="FINISHED">已结束</SelectItem>
                  <SelectItem value="CANCELED">已取消</SelectItem>
                </SelectContent>
              </Select>
            }
          />
        </>
      )}

      {/* 取消会议确认对话框 */}
      <Dialog open={cancelMeeting !== null} onOpenChange={(open) => !open && setCancelMeeting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>取消会议</DialogTitle>
            <DialogDescription>
              确定要取消「{cancelMeeting?.subject}」（{cancelMeeting?.date}{" "}
              {cancelMeeting?.startHour}:00，{cancelMeeting?.roomName}）吗？
              取消后系统将自动通知全部参会人并释放会议室。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelMeeting(null)}>
              返回
            </Button>
            <Button variant="destructive" onClick={() => void confirmCancel()}>
              确认取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
