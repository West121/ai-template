import { useCallback, useEffect, useMemo, useState } from "react"
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import { zhCN } from "date-fns/locale"
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudOff,
  MapPin,
  RotateCw,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { api, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

type EventType = "MEETING" | "REVIEW" | "TRIP" | "TRAINING" | "OTHER"

interface ScheduleEvent {
  id: number
  title: string
  date: string
  startTime: string
  endTime: string
  place?: string
  type: EventType
}

const typeText: Record<EventType, string> = {
  MEETING: "会议",
  REVIEW: "评审",
  TRIP: "出差",
  TRAINING: "培训",
  OTHER: "其他",
}

const typeStyle: Record<EventType, { bar: string; dot: string }> = {
  MEETING: { bar: "bg-blue-500/15 text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  REVIEW: { bar: "bg-violet-500/15 text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  TRIP: { bar: "bg-amber-500/15 text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  TRAINING: { bar: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  OTHER: { bar: "bg-rose-500/15 text-rose-700 dark:text-rose-300", dot: "bg-rose-500" },
}

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"]
const EVENT_TYPES: EventType[] = ["MEETING", "REVIEW", "TRIP", "TRAINING", "OTHER"]

export default function SchedulePage() {
  const today = useMemo(() => new Date(), [])
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = useState(today)
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    title: "",
    date: format(today, "yyyy-MM-dd"),
    start: "",
    end: "",
    place: "",
    type: "",
  })

  const offline = useAuthStore((s) => s.offline)
  const monthKey = format(currentMonth, "yyyy-MM")

  const load = useCallback(async (month: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await api<ScheduleEvent[]>(`/api/office/schedules?month=${month}`)
      setEvents(list)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  // 切换月份重新拉取
  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load(monthKey)
  }, [load, offline, monthKey])

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 }),
      }),
    [currentMonth],
  )

  const eventsByDate = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>()
    for (const e of events) {
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime))
    }
    return map
  }, [events])

  const selectedKey = format(selectedDate, "yyyy-MM-dd")
  const selectedEvents = eventsByDate.get(selectedKey) ?? []

  function goToday() {
    setCurrentMonth(startOfMonth(today))
    setSelectedDate(today)
  }

  async function handleCreate() {
    if (!form.title.trim() || !form.date || !form.start || !form.end || !form.type) {
      toast.error("请填写完整的日程信息")
      return
    }
    if (form.end <= form.start) {
      toast.error("结束时间必须晚于开始时间")
      return
    }
    setSubmitting(true)
    try {
      await api("/api/office/schedules", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          date: form.date,
          startTime: form.start,
          endTime: form.end,
          place: form.place.trim() || "待定",
          type: form.type,
        }),
      })
      const eventDate = parseISO(form.date)
      setCreateOpen(false)
      setSelectedDate(eventDate)
      const targetMonth = format(eventDate, "yyyy-MM")
      if (targetMonth === monthKey) {
        await load(monthKey)
      } else {
        setCurrentMonth(startOfMonth(eventDate)) // 触发按新月份重新拉取
      }
      toast.success(`日程「${form.title.trim()}」已创建`)
      setForm({ title: "", date: form.date, start: "", end: "", place: "", type: "" })
    } catch (err) {
      if (err instanceof NetworkError) toast.error("无法连接后端服务")
      else toast.error(err instanceof Error ? err.message : "创建失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(ev: ScheduleEvent) {
    try {
      await api(`/api/office/schedules/${ev.id}`, { method: "DELETE" })
      setEvents((prev) => prev.filter((e) => e.id !== ev.id))
      toast.success(`日程「${ev.title}」已删除`)
    } catch (err) {
      if (err instanceof NetworkError) toast.error("无法连接后端服务")
      else toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="日程管理" description="查看团队与个人日程安排，合理规划每一天" />

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot
              spring-boot:run，然后重新登录即可查看与维护真实日程。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void load(monthKey)}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void load(monthKey)}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          {/* 月历 */}
          <Card className="gap-4 py-4">
            <CardHeader className="flex flex-row items-center justify-between px-4">
              <CardTitle className="text-base">
                {format(currentMonth, "yyyy 年 M 月")}
                {loading && <span className="ml-2 text-xs font-normal text-muted-foreground">加载中…</span>}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={goToday}>
                  今天
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4">
              <div className="grid grid-cols-7 gap-1">
                {WEEK_LABELS.map((w) => (
                  <div key={w} className="pb-1 text-center text-xs font-medium text-muted-foreground">
                    {w}
                  </div>
                ))}
                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd")
                  const dayEvents = eventsByDate.get(key) ?? []
                  const inMonth = isSameMonth(day, currentMonth)
                  const isToday = isSameDay(day, today)
                  const isSelected = isSameDay(day, selectedDate)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDate(day)}
                      className={cn(
                        "flex min-h-20 flex-col items-stretch gap-1 rounded-md border border-transparent p-1.5 text-left transition-colors hover:bg-muted/50",
                        isSelected && "border-primary bg-primary/5",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center self-start rounded-full text-xs tabular-nums",
                          isToday && "bg-primary font-semibold text-primary-foreground",
                          !isToday && !inMonth && "text-muted-foreground/40",
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      {dayEvents.slice(0, 2).map((e) => (
                        <span
                          key={e.id}
                          className={cn("truncate rounded px-1 text-[10px] leading-4", typeStyle[e.type].bar)}
                          title={`${e.startTime} ${e.title}`}
                        >
                          {e.title}
                        </span>
                      ))}
                      {dayEvents.length > 2 && (
                        <span className="px-1 text-[10px] text-muted-foreground">+{dayEvents.length - 2} 项</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* 当日日程 */}
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-base">
                {format(selectedDate, "M 月 d 日 EEEE", { locale: zhCN })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4 px-4">
              {selectedEvents.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                  <Clock className="size-8 opacity-30" />
                  <span className="text-sm">当天暂无日程安排</span>
                </div>
              ) : (
                <div className="relative flex-1 space-y-4 before:absolute before:inset-y-1 before:left-[3px] before:w-px before:bg-border">
                  {selectedEvents.map((e) => (
                    <div key={e.id} className="group relative pl-5">
                      <span
                        className={cn(
                          "absolute left-0 top-1.5 size-[7px] rounded-full ring-2 ring-background",
                          typeStyle[e.type].dot,
                        )}
                      />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs tabular-nums text-muted-foreground">
                            {e.startTime} — {e.endTime}
                          </div>
                          <div className="mt-0.5 text-sm font-medium">{e.title}</div>
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="size-3" />
                            {e.place ?? "待定"}
                            <span className="ml-1 rounded bg-muted px-1 py-px text-[10px]">
                              {typeText[e.type]}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                          title="删除日程"
                          onClick={() => void handleDelete(e)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                className="w-full"
                onClick={() => {
                  setForm((f) => ({ ...f, date: selectedKey }))
                  setCreateOpen(true)
                }}
              >
                <CalendarPlus className="size-4" />
                新建日程
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 新建日程 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建日程</DialogTitle>
            <DialogDescription>创建后将同步到你的日历</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="ev-title">日程标题</Label>
              <Input
                id="ev-title"
                placeholder="如：产品方案讨论会"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-date">日期</Label>
              <Input
                id="ev-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ev-start">开始时间</Label>
                <Input
                  id="ev-start"
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ev-end">结束时间</Label>
                <Input
                  id="ev-end"
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ev-place">地点</Label>
                <Input
                  id="ev-place"
                  placeholder="如：3F 会议室 301"
                  value={form.place}
                  onChange={(e) => setForm({ ...form, place: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>类型</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {typeText[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button disabled={submitting} onClick={() => void handleCreate()}>
              {submitting ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
