/**
 * 工作台 · 风格A「经典」——沿用原 dashboard 版式（含 KPI 卡重设计：主色渐变底纹 + 角落水印 + ring 图标 + hover 上浮）。
 * 数据全部来自 useDashboardData（与风格B 共享真实数据 + 离线兜底）。
 */
import { useNavigate } from "react-router-dom"
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  CloudOff,
  Plane,
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
import { cn } from "@/lib/utils"
import { useDashboardData, type StatKey } from "./use-dashboard-data"

const quickActions = [
  { label: "请假申请", icon: SunMedium, color: "text-blue-600 bg-blue-500/10" },
  { label: "费用报销", icon: ReceiptText, color: "text-emerald-600 bg-emerald-500/10" },
  { label: "出差申请", icon: Plane, color: "text-violet-600 bg-violet-500/10" },
  { label: "用章申请", icon: Stamp, color: "text-orange-600 bg-orange-500/10" },
  { label: "采购申请", icon: Wallet, color: "text-pink-600 bg-pink-500/10" },
  { label: "入职办理", icon: UserRoundPlus, color: "text-cyan-600 bg-cyan-500/10" },
]

/** KPI 卡按 key 的配色（tint 图标底 / wash 渐变底纹 / ghost 角落水印） */
const KPI_STYLE: Record<StatKey, { tint: string; wash: string; ghost: string }> = {
  pending: { tint: "bg-blue-500/10 text-blue-600 ring-blue-500/20 dark:text-blue-400", wash: "from-blue-500/[0.09] to-transparent", ghost: "text-blue-500/[0.06]" },
  meeting: { tint: "bg-violet-500/10 text-violet-600 ring-violet-500/20 dark:text-violet-400", wash: "from-violet-500/[0.09] to-transparent", ghost: "text-violet-500/[0.06]" },
  attendance: { tint: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400", wash: "from-emerald-500/[0.09] to-transparent", ghost: "text-emerald-500/[0.06]" },
  announcement: { tint: "bg-orange-500/10 text-orange-600 ring-orange-500/20 dark:text-orange-400", wash: "from-orange-500/[0.09] to-transparent", ghost: "text-orange-500/[0.06]" },
}

export function DashboardClassic() {
  const navigate = useNavigate()
  const vm = useDashboardData()

  return (
    <div className="space-y-4">
      {/* 离线提示 */}
      {vm.degraded && (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <CloudOff className="size-3.5 shrink-0" />
          离线演示数据——启动后端（cd server && mvn -pl oa-boot spring-boot:run）并重新登录后展示真实数据
          <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => void vm.load()}>
            重试连接
          </Button>
        </div>
      )}

      {/* 欢迎区 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="bg-primary text-lg text-primary-foreground">{vm.userName.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">下午好，{vm.userName}，今天也要元气满满哦 ☀️</div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {vm.userDept} · {vm.userPost} ｜ 今天是 2026 年 7 月 13 日 星期一，多云转晴 26℃
            </div>
          </div>
          <div className="flex items-center gap-6 text-center">
            <div>
              <div className={cn("text-xl font-semibold", vm.checkInDisplay === "--:--" ? "text-muted-foreground/50" : "text-primary")}>
                {vm.checkInDisplay}
              </div>
              <div className="text-xs text-muted-foreground">上班打卡</div>
            </div>
            <Separator orientation="vertical" className="h-8" />
            <div>
              <div className={cn("text-xl font-semibold", vm.checkOutDisplay === "--:--" ? "text-muted-foreground/50" : "text-primary")}>
                {vm.checkOutDisplay}
              </div>
              <div className="text-xs text-muted-foreground">下班打卡</div>
            </div>
            <Button size="sm" disabled={vm.checking} onClick={() => void vm.handleCheck()}>
              <Clock3 className="size-4" /> 打卡
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {vm.stats.map((stat) => {
          const s = KPI_STYLE[stat.key]
          return (
            <Card
              key={stat.key}
              onClick={() => navigate(stat.path)}
              className="group relative cursor-pointer overflow-hidden border-border/60 py-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-transparent hover:shadow-lg"
            >
              <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70 transition-opacity duration-200 group-hover:opacity-100", s.wash)} />
              <stat.icon className={cn("pointer-events-none absolute -bottom-4 -right-3 size-24 rotate-12 transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-110", s.ghost)} />
              <CardContent className="relative flex flex-col gap-3.5 p-4">
                <div className="flex items-start justify-between">
                  <div className={cn("flex size-11 items-center justify-center rounded-xl ring-1 transition-transform duration-200 group-hover:scale-105", s.tint)}>
                    <stat.icon className="size-5.5" />
                  </div>
                  <ArrowUpRight className="size-4 -translate-x-1 text-muted-foreground/50 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
                </div>
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[1.75rem] font-bold leading-none tabular-nums tracking-tight">{stat.value}</span>
                    <span className="text-xs font-medium text-muted-foreground">{stat.unit}</span>
                  </div>
                  <div className="mt-1.5 text-sm text-muted-foreground">{stat.label}</div>
                </div>
              </CardContent>
            </Card>
          )
        })}
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
            {vm.pendingList.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">暂无待办审批，好好休息一下吧</div>}
            {vm.pendingList.map((item) => (
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
              {vm.weekData.map((d) => (
                <div key={d.day} className="group flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">{d.value}</span>
                  <div className="w-full rounded-t-md bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${(d.value / vm.weekMax) * 100}%` }} />
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
            {vm.announcements.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">暂无公告</div>}
            {vm.announcements.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center gap-2 py-2.5 text-left transition-colors hover:bg-accent/50"
                onClick={() => navigate("/announcement")}
              >
                {item.top && <Badge className="h-4.5 shrink-0 px-1.5 text-[10px]">置顶</Badge>}
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground/70">{item.dept} · {item.date}</span>
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
            {vm.todaySchedule.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">今天没有日程安排</div>}
            {vm.todaySchedule.map((item) => (
              <div key={item.id} className="flex gap-3 rounded-md px-1 py-2 transition-colors hover:bg-accent/50">
                <div className="flex flex-col items-center">
                  <span className={cn("text-sm font-medium", item.done ? "text-muted-foreground/50" : "text-primary")}>{item.time}</span>
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
