import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { CloudOff, MapPin, RotateCw, ShieldAlert, Users } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { api, NetworkError } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"

type DayKey = "today" | "tomorrow"

interface RoomBooking {
  startHour: number
  endHour: number
  subject: string
  booker: string
}

/** 后端会议室响应（bookings 为查询日当天） */
interface Room {
  id: number
  name: string
  floor: string
  capacity: number
  devices: string[]
  status: string // FREE | BUSY | MAINTAIN
  bookings: RoomBooking[]
}

/** 当日可预订整点时段：9:00–18:00，共 9 格 */
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17]

function formatDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function RoomStatusBadge({ status }: { status: string }) {
  if (status === "FREE") {
    return (
      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
        空闲
      </Badge>
    )
  }
  if (status === "BUSY") {
    return (
      <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600">
        使用中
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      维护中
    </Badge>
  )
}

function findBooking(bookings: RoomBooking[], hour: number) {
  return bookings.find((b) => b.startHour <= hour && hour < b.endHour)
}

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [day, setDay] = useState<DayKey>("today")

  // 预订对话框
  const [bookingRoomId, setBookingRoomId] = useState<number | null>(null)
  const [subject, setSubject] = useState("")
  const [startHour, setStartHour] = useState("9")
  const [endHour, setEndHour] = useState("10")
  const [submitting, setSubmitting] = useState(false)

  const offline = useAuthStore((s) => s.offline)

  const { todayStr, tomorrowStr } = useMemo(() => {
    const now = new Date()
    return {
      todayStr: formatDate(now),
      tomorrowStr: formatDate(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
    }
  }, [])

  const activeDate = day === "today" ? todayStr : tomorrowStr
  const dayLabel =
    day === "today" ? `今天（${todayStr.slice(5)}）` : `明天（${tomorrowStr.slice(5)}）`

  const bookingRoom = rooms.find((r) => r.id === bookingRoomId) ?? null

  const load = useCallback(async (date: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await api<Room[]>(`/api/office/meeting-rooms?date=${date}`)
      setRooms(list)
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
    void load(activeDate)
  }, [load, offline, activeDate])

  const openBooking = (room: Room) => {
    setSubject("")
    setStartHour("9")
    setEndHour("10")
    setBookingRoomId(room.id)
  }

  const confirmBooking = async () => {
    if (!bookingRoom) return
    if (!subject.trim()) {
      toast.warning("请填写会议主题")
      return
    }
    const start = Number(startHour)
    const end = Number(endHour)
    if (end <= start) {
      toast.warning("结束时段必须晚于开始时段")
      return
    }
    setSubmitting(true)
    try {
      await api("/api/office/meetings", {
        method: "POST",
        body: JSON.stringify({
          roomId: bookingRoom.id,
          subject: subject.trim(),
          date: activeDate,
          startHour: start,
          endHour: end,
        }),
      })
      setBookingRoomId(null)
      toast.success(
        `已预订 ${bookingRoom.name} ${dayLabel} ${start}:00-${end}:00「${subject.trim()}」`,
      )
      void load(activeDate)
    } catch (err) {
      // 409 时段冲突等：直接展示后端 message
      toast.error(err instanceof Error ? err.message : "预订失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="会议室预订"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : "查看各会议室当日时段占用情况，快速预订空闲时段"
        }
        actions={
          <Tabs value={day} onValueChange={(v) => setDay(v as DayKey)}>
            <TabsList>
              <TabsTrigger value="today">今天 {todayStr.slice(5)}</TabsTrigger>
              <TabsTrigger value="tomorrow">明天 {tomorrowStr.slice(5)}</TabsTrigger>
            </TabsList>
          </Tabs>
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
              spring-boot:run，然后重新登录，即可查看真实会议室占用并在线预订（时段冲突由后端校验）。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void load(activeDate)}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void load(activeDate)}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => (
            <Card key={room.id} className="gap-4">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{room.name}</CardTitle>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3.5" />
                        {room.floor}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="size-3.5" />
                        可容纳 {room.capacity} 人
                      </span>
                    </div>
                  </div>
                  <RoomStatusBadge status={room.status} />
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {room.devices.map((device) => (
                    <Badge key={device} variant="secondary" className="text-xs font-normal">
                      {device}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <div className="text-xs text-muted-foreground">
                  {dayLabel} 时段占用（9:00–18:00）
                </div>
                <div className="grid grid-cols-9 gap-1">
                  {HOURS.map((hour) => {
                    const booking = findBooking(room.bookings, hour)
                    if (!booking) {
                      return <div key={hour} className="h-6 rounded-sm bg-muted" />
                    }
                    return (
                      <Tooltip key={hour}>
                        <TooltipTrigger asChild>
                          <div className="h-6 cursor-default rounded-sm bg-primary/70" />
                        </TooltipTrigger>
                        <TooltipContent>
                          {booking.startHour}:00-{booking.endHour}:00 {booking.subject} ·{" "}
                          {booking.booker}
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>9:00</span>
                  <span>13:00</span>
                  <span>18:00</span>
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={room.status === "MAINTAIN" ? "outline" : "default"}
                  disabled={room.status === "MAINTAIN"}
                  onClick={() => openBooking(room)}
                >
                  {room.status === "MAINTAIN" ? "维护中，暂停预订" : "预订"}
                </Button>
              </CardFooter>
            </Card>
          ))}
          {rooms.length === 0 && (
            <div className="col-span-full py-16 text-center text-sm text-muted-foreground">
              暂无会议室数据
            </div>
          )}
        </div>
      )}

      {/* 预订对话框 */}
      <Dialog open={bookingRoomId !== null} onOpenChange={(open) => !open && setBookingRoomId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>预订 {bookingRoom?.name}</DialogTitle>
            <DialogDescription>
              {dayLabel} · {bookingRoom?.floor} · 可容纳 {bookingRoom?.capacity} 人
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="meeting-subject">会议主题</Label>
              <Input
                id="meeting-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="如：产品评审会"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>开始时段</Label>
                <Select value={startHour} onValueChange={setStartHour}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>结束时段</Label>
                <Select value={endHour} onValueChange={setEndHour}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => (
                      <SelectItem key={h + 1} value={String(h + 1)}>
                        {h + 1}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingRoomId(null)}>
              取消
            </Button>
            <Button disabled={submitting} onClick={() => void confirmBooking()}>
              {submitting ? "预订中…" : "确认预订"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
