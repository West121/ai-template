import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowRight,
  CalendarClock,
  Clock3,
  CloudOff,
  FileCheck2,
  Megaphone,
  Plane,
  Presentation,
  ReceiptText,
  Stamp,
  SunMedium,
  UserRoundPlus,
  Video,
  Wallet,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import { type WfTaskItem } from "@/types/workflow"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

/* ------------------------------ 离线演示数据（后端未启动时兜底渲染） ------------------------------ */

const mockStats = { pendingCount: 5, todayMeetings: 2, monthAttendanceDays: 21, unreadAnnouncements: 2 }

const quickActions = [
  { label: "请假申请", icon: SunMedium, color: "text-blue-600 bg-blue-500/10" },
  { label: "费用报销", icon: ReceiptText, color: "text-emerald-600 bg-emerald-500/10" },
  { label: "出差申请", icon: Plane, color: "text-violet-600 bg-violet-500/10" },
  { label: "用章申请", icon: Stamp, color: "text-orange-600 bg-orange-500/10" },
  { label: "采购申请", icon: Wallet, color: "text-pink-600 bg-pink-500/10" },
  { label: "入职办理", icon: UserRoundPlus, color: "text-cyan-600 bg-cyan-500/10" },
]

interface PendingItem {
  id: number | string
  title: string
  type: string
  applicant: string
  time: string
  urgent?: boolean
}

const mockPendingList: PendingItem[] = [
  { id: "SP20260706001", title: "李晓的请假申请", type: "请假", applicant: "李晓", time: "30 分钟前", urgent: true },
  { id: "SP20260706002", title: "市场部差旅费报销单", type: "报销", applicant: "张伟", time: "1 小时前", urgent: false },
  { id: "SP20260705018", title: "「CRM 系统采购」合同会签", type: "采购", applicant: "陈静", time: "3 小时前", urgent: true },
  { id: "SP20260705012", title: "王芳的加班申请", type: "加班", applicant: "王芳", time: "昨天 17:40", urgent: false },
  { id: "SP20260704009", title: "产品部办公用品采购", type: "采购", applicant: "刘洋", time: "昨天 10:22", urgent: false },
]

interface AnnouncementItem {
  id: number | string
  title: string
  dept: string
  date: string
  top: boolean
}

const mockAnnouncements: AnnouncementItem[] = [
  { id: 1, title: "关于 2026 年中秋节放假安排的通知", dept: "行政部", date: "07-06", top: true },
  { id: 2, title: "第三季度全员大会通知", dept: "总裁办", date: "07-05", top: true },
  { id: 3, title: "信息安全管理规定（2026 修订版）发布", dept: "信息中心", date: "07-02", top: false },
  { id: 4, title: "员工体检安排通知", dept: "人力资源部", date: "06-28", top: false },
]

interface ScheduleItem {
  id: number | string
  time: string
  title: string
  place: string
  done: boolean
}

const mockTodaySchedule: ScheduleItem[] = [
  { id: 1, time: "10:00", title: "产品迭代周会", place: "3F · 云汉会议室", done: true },
  { id: 2, time: "14:00", title: "产品评审会", place: "5F · 星河会议室", done: false },
  { id: 3, time: "16:30", title: "与设计团队对齐视觉规范", place: "线上 · 腾讯会议", done: false },
]

/** 近 7 日审批处理量（纯 CSS 柱状图） */
const mockWeekData = [
  { day: "周一", value: 8 },
  { day: "周二", value: 12 },
  { day: "周三", value: 6 },
  { day: "周四", value: 15 },
  { day: "周五", value: 10 },
  { day: "周六", value: 3 },
  { day: "周日", value: 5 },
]

/* ------------------------------------- 契约响应结构 ------------------------------------- */

interface DashboardData {
  pendingCount: number
  todayMeetings: number
  monthAttendanceDays: number
  unreadAnnouncements: number
  todayCheckIn?: string
  pendingList: { id: number; title: string; type: string; applicant: string; createdAt?: string }[]
  announcements: { id: number; title: string; deptName?: string; publisher?: string; top?: boolean; publishAt?: string }[]
  todaySchedules: { id: number; title: string; startTime: string; endTime?: string; place?: string }[]
  weekApprovalStats: { day: string; count: number }[]
}

interface AttendanceRecord {
  date: string
  checkIn?: string
  checkOut?: string
}

function relativeTime(iso?: string) {
  if (!iso) return "—"
  return iso.slice(5, 16).replace("T", " ")
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)

  const [data, setData] = useState<DashboardData | null>(null)
  const [degraded, setDegraded] = useState(false) // offline 或 NetworkError → 用离线演示数据渲染
  const [checkIn, setCheckIn] = useState<string | null>(null)
  const [checkOut, setCheckOut] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // 「待我审批」口径 = wf 引擎待办（与「我的审批」页 / 菜单角标一致）；
  // office dashboard 的 pendingCount 是旧审批(oa_approval)口径，已不用于此展示。
  const [wfTodo, setWfTodo] = useState<{ total: number; list: WfTaskItem[] }>({ total: 0, list: [] })

  const load = useCallback(async () => {
    if (useAuthStore.getState().offline) {
      setDegraded(true)
      return
    }
    try {
      const d = await api<DashboardData>("/api/office/dashboard")
      setData(d)
      setDegraded(false)
      setCheckIn(d.todayCheckIn ?? null)
    } catch (err) {
      if (err instanceof NetworkError) setDegraded(true)
      else toast.error(err instanceof Error ? err.message : "工作台数据加载失败")
    }
    // 「待我审批」走 wf 引擎待办（同「我的审批」页）；单独拉取，失败不影响其它卡片
    try {
      const page = await api<PageResult<WfTaskItem>>("/api/wf/tasks/todo?pageNum=1&pageSize=5")
      setWfTodo({ total: page.total, list: page.list })
    } catch {
      /* 待办拉取失败：保持 0，不影响工作台其它数据 */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, offline, activeAssignmentId])

  const handleCheck = async () => {
    if (offline || degraded) {
      toast.success("打卡成功：17:58（离线演示）")
      return
    }
    setChecking(true)
    try {
      const record = await api<AttendanceRecord>("/api/office/attendance/check", {
        method: "POST",
        body: JSON.stringify({}),
      })
      const time = record.checkOut ?? record.checkIn
      setCheckIn(record.checkIn ?? null)
      setCheckOut(record.checkOut ?? null)
      toast.success(`打卡成功：${time ?? ""}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打卡失败")
    } finally {
      setChecking(false)
    }
  }

  // 统一视图数据：在线用接口返回，离线沿用演示常量
  const stats = [
    {
      label: "待我审批",
      value: degraded ? mockStats.pendingCount : wfTodo.total,
      unit: "项",
      icon: FileCheck2,
      color: "text-blue-600 bg-blue-500/10",
      path: "/workflow/tasks",
    },
    {
      label: "今日会议",
      value: degraded ? mockStats.todayMeetings : (data?.todayMeetings ?? 0),
      unit: "场",
      icon: Presentation,
      color: "text-violet-600 bg-violet-500/10",
      path: "/meeting/my",
    },
    {
      label: "本月出勤",
      value: degraded ? mockStats.monthAttendanceDays : (data?.monthAttendanceDays ?? 0),
      unit: "天",
      icon: CalendarClock,
      color: "text-emerald-600 bg-emerald-500/10",
      path: "/attendance/record",
    },
    {
      label: "未读公告",
      value: degraded ? mockStats.unreadAnnouncements : (data?.unreadAnnouncements ?? 0),
      unit: "条",
      icon: Megaphone,
      color: "text-orange-600 bg-orange-500/10",
      path: "/announcement",
    },
  ]

  // 「待我审批」预览列表同样走 wf 待办（与卡片数、我的审批页一致）
  const pendingList: PendingItem[] = degraded
    ? mockPendingList
    : wfTodo.list.map((t) => ({
        id: t.taskId,
        title: t.instanceTitle,
        type: t.defName,
        applicant: t.initiatorName,
        time: relativeTime(t.createdAt),
      }))

  const announcements: AnnouncementItem[] = degraded
    ? mockAnnouncements
    : (data?.announcements ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        dept: item.deptName ?? item.publisher ?? "—",
        date: item.publishAt ? item.publishAt.slice(5, 10) : "—",
        top: item.top ?? false,
      }))

  const nowHm = new Date().toTimeString().slice(0, 5)
  const todaySchedule: ScheduleItem[] = degraded
    ? mockTodaySchedule
    : (data?.todaySchedules ?? []).map((item) => ({
        id: item.id,
        time: item.startTime,
        title: item.title,
        place: item.place ?? "—",
        done: item.startTime < nowHm,
      }))

  const weekData = degraded
    ? mockWeekData
    : (data?.weekApprovalStats ?? []).map((d) => ({ day: d.day, value: d.count }))
  const max = Math.max(1, ...weekData.map((d) => d.value))

  const checkInDisplay = degraded ? "09:02" : (checkIn ?? "--:--")
  const checkOutDisplay = degraded ? "--:--" : (checkOut ?? "--:--")

  return (
    <div className="space-y-4">
      {/* 离线提示 */}
      {degraded && (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <CloudOff className="size-3.5 shrink-0" />
          离线演示数据——启动后端（cd server && mvn -pl oa-boot spring-boot:run）并重新登录后展示真实数据
          <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => void load()}>
            重试连接
          </Button>
        </div>
      )}

      {/* 欢迎区 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="bg-primary text-lg text-primary-foreground">
              {user?.name?.slice(0, 1) ?? "客"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">
              下午好，{user?.name ?? "访客"}，今天也要元气满满哦 ☀️
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {user?.dept} · {user?.post} ｜ 今天是 2026 年 7 月 7 日 星期二，多云转晴 26℃
            </div>
          </div>
          <div className="flex items-center gap-6 text-center">
            <div>
              <div
                className={cn(
                  "text-xl font-semibold",
                  checkInDisplay === "--:--" ? "text-muted-foreground/50" : "text-primary",
                )}
              >
                {checkInDisplay}
              </div>
              <div className="text-xs text-muted-foreground">上班打卡</div>
            </div>
            <Separator orientation="vertical" className="h-8" />
            <div>
              <div
                className={cn(
                  "text-xl font-semibold",
                  checkOutDisplay === "--:--" ? "text-muted-foreground/50" : "text-primary",
                )}
              >
                {checkOutDisplay}
              </div>
              <div className="text-xs text-muted-foreground">下班打卡</div>
            </div>
            <Button size="sm" disabled={checking} onClick={() => void handleCheck()}>
              <Clock3 className="size-4" /> 打卡
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className="cursor-pointer py-4 transition-shadow hover:shadow-md"
            onClick={() => navigate(stat.path)}
          >
            <CardContent className="flex items-center gap-3.5 px-4">
              <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", stat.color)}>
                <stat.icon className="size-5.5" />
              </div>
              <div>
                <div className="text-2xl font-semibold leading-tight">
                  {stat.value}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">{stat.unit}</span>
                </div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* 待办审批 */}
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">待办审批</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => navigate("/workflow/tasks")}>
              查看全部 <ArrowRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="divide-y">
            {pendingList.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无待办审批，好好休息一下吧</div>
            )}
            {pendingList.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                onClick={() => navigate("/workflow/tasks")}
              >
                <Badge variant="outline" className="shrink-0">{item.type}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {item.title}
                  {item.urgent && <Badge variant="destructive" className="ml-2 h-4 px-1 text-[10px]">加急</Badge>}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{item.applicant}</span>
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground/70">{item.time}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* 快捷入口 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">快捷发起</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="flex flex-col items-center gap-2 rounded-lg border py-4 transition-colors hover:border-primary/40 hover:bg-accent"
                  onClick={() => navigate("/workflow/start")}
                >
                  <div className={cn("flex size-10 items-center justify-center rounded-lg", action.color)}>
                    <action.icon className="size-5" />
                  </div>
                  <span className="text-xs">{action.label}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 近 7 日审批 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">近 7 日审批处理量</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-end gap-3">
              {weekData.map((d) => (
                <div key={d.day} className="group flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    {d.value}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-primary/75 transition-colors group-hover:bg-primary"
                    style={{ height: `${(d.value / max) * 100}%` }}
                  />
                  <span className="text-xs text-muted-foreground">{d.day}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 公告 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">公告通知</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => navigate("/announcement")}>
              更多 <ArrowRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="divide-y">
            {announcements.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无公告</div>
            )}
            {announcements.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center gap-2 py-2.5 text-left transition-colors hover:bg-accent/50"
                onClick={() => navigate("/announcement")}
              >
                {item.top && <Badge className="h-4.5 shrink-0 px-1.5 text-[10px]">置顶</Badge>}
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground/70">
                  {item.dept} · {item.date}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* 今日日程 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">今日日程</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => navigate("/schedule")}>
              日程表 <ArrowRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {todaySchedule.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">今天没有日程安排</div>
            )}
            {todaySchedule.map((item) => (
              <div key={item.id} className="flex gap-3 rounded-md px-1 py-2 transition-colors hover:bg-accent/50">
                <div className="flex flex-col items-center">
                  <span className={cn("text-sm font-medium", item.done ? "text-muted-foreground/50" : "text-primary")}>
                    {item.time}
                  </span>
                  <div className="mt-1 w-px flex-1 bg-border" />
                </div>
                <div className="pb-1">
                  <div className={cn("flex items-center gap-1.5 text-sm", item.done && "text-muted-foreground/50 line-through")}>
                    <Video className="size-3.5 shrink-0 text-muted-foreground" />
                    {item.title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground/70">{item.place}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
