/**
 * 工作台共享数据 hook（风格 A 经典 / 风格 B 聚焦 共用同一份真实数据）。
 * 从原 dashboard/index.tsx 抽出：接口加载 + wf 待办 + 打卡 + 离线兜底(degraded) + 派生视图数据。
 * 视图只读取本 hook 的派生结果，不各自再拉一遍——两个风格切换不重复请求（每次只渲染其一）。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  CalendarClock,
  FileCheck2,
  Megaphone,
  Presentation,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import { type WfTaskItem } from "@/types/workflow"

/* ------------------------------ 契约响应结构 ------------------------------ */

export interface DashboardData {
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

/* ------------------------------ 派生视图类型 ------------------------------ */

export type StatKey = "pending" | "meeting" | "attendance" | "announcement"

export interface StatItem {
  key: StatKey
  label: string
  value: number
  unit: string
  icon: LucideIcon
  path: string
}

export interface PendingItem {
  id: number | string
  title: string
  type: string
  applicant: string
  time: string
  urgent?: boolean
}

export interface AnnouncementItem {
  id: number | string
  title: string
  dept: string
  date: string
  top: boolean
}

export interface ScheduleItem {
  id: number | string
  time: string
  title: string
  place: string
  done: boolean
}

export interface WeekPoint {
  day: string
  value: number
}

/* ------------------------------ 离线演示数据（后端未启动兜底） ------------------------------ */

const mockStats = { pendingCount: 5, todayMeetings: 2, monthAttendanceDays: 21, unreadAnnouncements: 2 }

const mockPendingList: PendingItem[] = [
  { id: "SP20260706001", title: "李晓的请假申请", type: "请假", applicant: "李晓", time: "30 分钟前", urgent: true },
  { id: "SP20260706002", title: "市场部差旅费报销单", type: "报销", applicant: "张伟", time: "1 小时前", urgent: false },
  { id: "SP20260705018", title: "「CRM 系统采购」合同会签", type: "采购", applicant: "陈静", time: "3 小时前", urgent: true },
  { id: "SP20260705012", title: "王芳的加班申请", type: "加班", applicant: "王芳", time: "昨天 17:40", urgent: false },
  { id: "SP20260704009", title: "产品部办公用品采购", type: "采购", applicant: "刘洋", time: "昨天 10:22", urgent: false },
]

const mockAnnouncements: AnnouncementItem[] = [
  { id: 1, title: "关于 2026 年中秋节放假安排的通知", dept: "行政部", date: "07-06", top: true },
  { id: 2, title: "第三季度全员大会通知", dept: "总裁办", date: "07-05", top: true },
  { id: 3, title: "信息安全管理规定（2026 修订版）发布", dept: "信息中心", date: "07-02", top: false },
  { id: 4, title: "员工体检安排通知", dept: "人力资源部", date: "06-28", top: false },
]

const mockTodaySchedule: ScheduleItem[] = [
  { id: 1, time: "10:00", title: "产品迭代周会", place: "3F · 云汉会议室", done: true },
  { id: 2, time: "14:00", title: "产品评审会", place: "5F · 星河会议室", done: false },
  { id: 3, time: "16:30", title: "与设计团队对齐视觉规范", place: "线上 · 腾讯会议", done: false },
]

const mockWeekData: WeekPoint[] = [
  { day: "周一", value: 8 },
  { day: "周二", value: 12 },
  { day: "周三", value: 6 },
  { day: "周四", value: 15 },
  { day: "周五", value: 10 },
  { day: "周六", value: 3 },
  { day: "周日", value: 5 },
]

/** 列表响应归一：只接受数组，其它一律兜底为 []（防白屏第 2 层） */
function normArray<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : []
}

function relativeTime(iso?: string) {
  if (!iso) return "—"
  return iso.slice(5, 16).replace("T", " ")
}

/** 时段问候：<11 上午 / <18 下午 / 其余 晚上 */
export function greetingByHour(h = new Date().getHours()): string {
  if (h < 11) return "上午好"
  if (h < 18) return "下午好"
  return "晚上好"
}

export interface DashboardVM {
  userName: string
  userDept?: string
  userPost?: string
  degraded: boolean
  load: () => Promise<void>
  checking: boolean
  handleCheck: () => Promise<void>
  checkInDisplay: string
  checkOutDisplay: string
  hasCheckIn: boolean
  hasCheckOut: boolean
  metrics: { pendingCount: number; todayMeetings: number; monthAttendanceDays: number; unreadAnnouncements: number }
  stats: StatItem[]
  pendingList: PendingItem[]
  urgentCount: number
  announcements: AnnouncementItem[]
  todaySchedule: ScheduleItem[]
  nextSchedule: ScheduleItem | null
  weekData: WeekPoint[]
  weekMax: number
}

export function useDashboardData(): DashboardVM {
  const user = useAuthStore((s) => s.user)
  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)

  const [data, setData] = useState<DashboardData | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [checkIn, setCheckIn] = useState<string | null>(null)
  const [checkOut, setCheckOut] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // 「待我审批」= wf 引擎待办（同「我的审批」页 / 菜单角标）；office dashboard 的 pendingCount 是旧口径不用于展示
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
    try {
      const page = await api<PageResult<WfTaskItem>>("/api/wf/tasks/todo?pageNum=1&pageSize=5")
      setWfTodo({ total: page.total, list: normArray<WfTaskItem>(page.list) })
    } catch {
      /* 待办拉取失败：保持 0，不影响其它数据 */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, offline, activeAssignmentId])

  const handleCheck = useCallback(async () => {
    if (useAuthStore.getState().offline || degraded) {
      toast.success("打卡成功：17:58（离线演示）")
      return
    }
    setChecking(true)
    try {
      const record = await api<AttendanceRecord>("/api/office/attendance/check", { method: "POST", body: JSON.stringify({}) })
      const time = record.checkOut ?? record.checkIn
      setCheckIn(record.checkIn ?? null)
      setCheckOut(record.checkOut ?? null)
      toast.success(`打卡成功：${time ?? ""}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打卡失败")
    } finally {
      setChecking(false)
    }
  }, [degraded])

  const metrics = useMemo(
    () => ({
      pendingCount: degraded ? mockStats.pendingCount : wfTodo.total,
      todayMeetings: degraded ? mockStats.todayMeetings : (data?.todayMeetings ?? 0),
      monthAttendanceDays: degraded ? mockStats.monthAttendanceDays : (data?.monthAttendanceDays ?? 0),
      unreadAnnouncements: degraded ? mockStats.unreadAnnouncements : (data?.unreadAnnouncements ?? 0),
    }),
    [degraded, wfTodo.total, data],
  )

  const stats = useMemo<StatItem[]>(
    () => [
      { key: "pending", label: "待我审批", value: metrics.pendingCount, unit: "项", icon: FileCheck2, path: "/workflow/tasks" },
      { key: "meeting", label: "今日会议", value: metrics.todayMeetings, unit: "场", icon: Presentation, path: "/meeting/my" },
      { key: "attendance", label: "本月出勤", value: metrics.monthAttendanceDays, unit: "天", icon: CalendarClock, path: "/attendance/record" },
      { key: "announcement", label: "未读公告", value: metrics.unreadAnnouncements, unit: "条", icon: Megaphone, path: "/announcement" },
    ],
    [metrics],
  )

  const pendingList = useMemo<PendingItem[]>(
    () =>
      degraded
        ? mockPendingList
        : normArray<WfTaskItem>(wfTodo.list).map((t) => ({
            id: t.taskId,
            title: t.instanceTitle,
            type: t.defName,
            applicant: t.initiatorName,
            time: relativeTime(t.createdAt),
          })),
    [degraded, wfTodo.list],
  )

  const urgentCount = useMemo(() => pendingList.filter((p) => p.urgent).length, [pendingList])

  const announcements = useMemo<AnnouncementItem[]>(
    () =>
      degraded
        ? mockAnnouncements
        : normArray<DashboardData["announcements"][number]>(data?.announcements).map((item) => ({
            id: item.id,
            title: item.title,
            dept: item.deptName ?? item.publisher ?? "—",
            date: item.publishAt ? item.publishAt.slice(5, 10) : "—",
            top: item.top ?? false,
          })),
    [degraded, data],
  )

  const todaySchedule = useMemo<ScheduleItem[]>(() => {
    const nowHm = new Date().toTimeString().slice(0, 5)
    return degraded
      ? mockTodaySchedule
      : normArray<DashboardData["todaySchedules"][number]>(data?.todaySchedules).map((item) => ({
          id: item.id,
          time: item.startTime,
          title: item.title,
          place: item.place ?? "—",
          done: item.startTime < nowHm,
        }))
  }, [degraded, data])

  const nextSchedule = useMemo(() => todaySchedule.find((s) => !s.done) ?? null, [todaySchedule])

  const weekData = useMemo<WeekPoint[]>(
    () =>
      degraded
        ? mockWeekData
        : normArray<DashboardData["weekApprovalStats"][number]>(data?.weekApprovalStats).map((d) => ({ day: d.day, value: d.count })),
    [degraded, data],
  )
  const weekMax = useMemo(() => Math.max(1, ...weekData.map((d) => d.value)), [weekData])

  const checkInDisplay = degraded ? "09:02" : (checkIn ?? "--:--")
  const checkOutDisplay = degraded ? "--:--" : (checkOut ?? "--:--")

  return {
    userName: user?.name ?? "访客",
    userDept: user?.dept,
    userPost: user?.post,
    degraded,
    load,
    checking,
    handleCheck,
    checkInDisplay,
    checkOutDisplay,
    hasCheckIn: checkInDisplay !== "--:--",
    hasCheckOut: checkOutDisplay !== "--:--",
    metrics,
    stats,
    pendingList,
    urgentCount,
    announcements,
    todaySchedule,
    nextSchedule,
    weekData,
    weekMax,
  }
}
