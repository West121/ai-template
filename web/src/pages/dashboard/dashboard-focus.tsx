/**
 * 工作台 · 风格B「清爽聚焦」——照丹青概念稿 B 落地（大留白 + 通栏 AI 今日速览一句话 + 今日聚焦三栏 + 柔和渐变圆润）。
 * 数据全部来自 useDashboardData（真实数据 + 离线兜底），概念稿的假数据不使用。明暗双主题均以 token 适配。
 */
import { useNavigate } from "react-router-dom"
import {
  AlarmClockCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CloudOff,
  Inbox,
  Megaphone,
  Plane,
  ReceiptText,
  Sparkles,
  Stamp,
  SunMedium,
  TrendingUp,
  TriangleAlert,
  UserRoundPlus,
  Wallet,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  greetingByHour,
  useDashboardData,
  type PendingItem,
  type ScheduleItem,
  type WeekPoint,
} from "./use-dashboard-data"

/* 概念稿 5 色（sky/mint/peach/lav/rose）→ token 化，明暗都清晰 */
const TAG_TONES = [
  "bg-sky-500/12 text-sky-600 dark:text-sky-300",
  "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  "bg-orange-500/12 text-orange-600 dark:text-orange-300",
  "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  "bg-rose-500/12 text-rose-600 dark:text-rose-300",
]
const TYPE_TONE: Record<string, number> = { 请假: 0, 报销: 1, 采购: 2, 加班: 3, 合同: 4, 出差: 0, 用章: 3, 会签: 4 }
function toneForType(type: string, index: number): string {
  const t = TYPE_TONE[type]
  return TAG_TONES[t ?? index % TAG_TONES.length]
}

const quickActions = [
  { label: "请假申请", icon: SunMedium, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-300" },
  { label: "费用报销", icon: ReceiptText, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" },
  { label: "出差申请", icon: Plane, tone: "bg-orange-500/12 text-orange-600 dark:text-orange-300" },
  { label: "用章申请", icon: Stamp, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-300" },
  { label: "采购申请", icon: Wallet, tone: "bg-rose-500/12 text-rose-600 dark:text-rose-300" },
  { label: "入职办理", icon: UserRoundPlus, tone: "bg-primary/12 text-primary" },
]

/** 圆润卡壳 */
function FocusCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-3xl border border-border/60 bg-card p-6 shadow-sm", className)}>{children}</div>
  )
}

/** 近 7 日审批处理量：自绘 SVG 折线 + 面积（无第三方库；空数据兜底） */
function WeekChart({ data, max }: { data: WeekPoint[]; max: number }) {
  if (data.length === 0) return <div className="py-10 text-center text-sm text-muted-foreground">暂无审批数据</div>
  const W = 720
  const padX = 40
  const top = 25
  const bottom = 175
  const n = data.length
  const xs = n > 1 ? data.map((_, i) => padX + (i * (W - 2 * padX)) / (n - 1)) : [W / 2]
  const ys = data.map((d) => bottom - (d.value / max) * (bottom - top))
  const linePath = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ")
  const areaPath = `${linePath} L${xs[n - 1].toFixed(1)} ${bottom} L${xs[0].toFixed(1)} ${bottom} Z`
  return (
    <div className="overflow-x-auto text-primary">
      <svg viewBox={`0 0 ${W} 210`} className="h-auto w-full min-w-[460px]">
        <defs>
          <linearGradient id="focusAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="stroke-border" strokeWidth={1}>
          {[25, 75, 125, 175].map((y) => (
            <line key={y} x1={padX} y1={y} x2={W - padX} y2={y} />
          ))}
        </g>
        <path d={areaPath} fill="url(#focusAreaGrad)" stroke="none" />
        <path d={linePath} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        <g className="fill-background" stroke="currentColor" strokeWidth={2.6}>
          {xs.map((x, i) => (
            <circle key={i} cx={x} cy={ys[i]} r={3.6} />
          ))}
        </g>
        <g className="fill-muted-foreground tabular-nums" fontSize={12} textAnchor="middle">
          {xs.map((x, i) => (
            <text key={i} x={x} y={ys[i] - 11}>
              {data[i].value}
            </text>
          ))}
        </g>
        <g className="fill-muted-foreground" fontSize={12.5} textAnchor="middle">
          {xs.map((x, i) => (
            <text key={i} x={x} y={200}>
              {data[i].day}
            </text>
          ))}
        </g>
      </svg>
    </div>
  )
}

export function DashboardFocus() {
  const navigate = useNavigate()
  const vm = useDashboardData()

  const clockState = vm.hasCheckOut ? "今日已完成上下班打卡" : vm.hasCheckIn ? "别忘了下班打卡" : "今日还未打卡"
  const clockChip = vm.hasCheckOut ? "打卡 · 已完成" : vm.hasCheckIn ? "打卡 · 待下班" : "打卡 · 待上班"

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      {/* 离线提示 */}
      {vm.degraded && (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <CloudOff className="size-3.5 shrink-0" />
          离线演示数据——启动后端并重新登录后展示真实数据
          <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => void vm.load()}>
            重试连接
          </Button>
        </div>
      )}

      {/* 问候行 */}
      <header className="flex flex-wrap items-center justify-between gap-5 px-1">
        <div className="flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-2xl font-semibold text-primary-foreground shadow-lg shadow-primary/25">
            {vm.userName.slice(0, 1)}
          </div>
          <div>
            <div className="text-2xl font-semibold tracking-tight">
              {greetingByHour()}，{vm.userName} <span className="text-xl">☀️</span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {vm.userDept ? `${vm.userDept} · ` : ""}
              {vm.userPost ?? "星辰 OA"} ｜ 2026 年 7 月 13 日 星期一 · 多云转晴 26℃
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={cn("flex min-w-24 flex-col rounded-2xl border px-4 py-2", vm.hasCheckIn ? "border-primary/20 bg-primary/[0.06]" : "border-border")}>
            <span className="text-[11px] text-muted-foreground">上班</span>
            <span className={cn("text-lg font-semibold tabular-nums", vm.hasCheckIn ? "text-primary" : "text-muted-foreground/60")}>{vm.checkInDisplay}</span>
          </div>
          <div className={cn("flex min-w-24 flex-col rounded-2xl border px-4 py-2", vm.hasCheckOut ? "border-primary/20 bg-primary/[0.06]" : "border-border")}>
            <span className="text-[11px] text-muted-foreground">下班</span>
            <span className={cn("text-lg font-semibold tabular-nums", vm.hasCheckOut ? "text-primary" : "text-muted-foreground/60")}>{vm.checkOutDisplay}</span>
          </div>
          <Button
            disabled={vm.checking}
            onClick={() => void vm.handleCheck()}
            className="gap-2 rounded-full bg-gradient-to-br from-primary to-primary/85 px-5 shadow-md shadow-primary/25 hover:brightness-105"
          >
            <Clock3 className="size-4" /> {vm.hasCheckIn ? "下班打卡" : "上班打卡"}
          </Button>
        </div>
      </header>

      {/* AI 今日速览带 */}
      <section className="relative overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-br from-primary/[0.07] via-violet-500/[0.05] to-transparent p-7 shadow-sm dark:border-primary/20 dark:from-primary/[0.13] dark:via-violet-500/[0.10]">
        <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-violet-500/10 blur-2xl dark:bg-violet-500/15" />
        <div className="relative flex items-start gap-5">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-primary/15 bg-background/70 text-primary">
            <Sparkles className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary/80">AI 今日速览</div>
            <p className="mt-2 max-w-[52em] text-[15px] leading-relaxed text-foreground/90">
              {greetingByHour()}，{vm.userName}，你有 <b className="font-semibold text-primary">{vm.metrics.pendingCount} 项待办</b>
              {vm.urgentCount > 0 && (
                <>
                  （其中 <span className="font-semibold text-rose-500">{vm.urgentCount} 项加急</span>需优先处理）
                </>
              )}
              、<b className="font-semibold text-primary">{vm.metrics.todayMeetings} 场会议</b>、
              <b className="font-semibold text-primary">{vm.metrics.unreadAnnouncements} 条未读公告</b>
              {vm.nextSchedule && (
                <>
                  ，下一场 <b className="font-semibold text-primary">{vm.nextSchedule.time} {vm.nextSchedule.title}</b>
                </>
              )}
              ；{clockState}。
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {vm.urgentCount > 0 && (
                <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <i className="size-1.5 rounded-full bg-rose-500" />优先处理 · 加急 <span className="tabular-nums text-foreground">{vm.urgentCount}</span> 项
                </span>
              )}
              {vm.nextSchedule && (
                <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <i className="size-1.5 rounded-full bg-sky-500" />下一场 · <span className="tabular-nums text-foreground">{vm.nextSchedule.time}</span> {vm.nextSchedule.title}
                </span>
              )}
              <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <i className="size-1.5 rounded-full bg-emerald-500" />{clockChip}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 今日聚焦 三栏 */}
      <section>
        <h2 className="mb-4 px-1 text-base font-semibold tracking-tight">今日聚焦</h2>
        <div className="grid gap-5 lg:grid-cols-3">
          {/* 栏1 待我处理 */}
          <FocusCard>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                <Inbox className="size-[18px] text-primary" /> 待我处理
              </div>
              <button type="button" className="inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-primary" onClick={() => navigate("/workflow/tasks")}>
                查看全部 <ChevronRight className="size-3.5" />
              </button>
            </div>
            {vm.pendingList.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">暂无待办，休息一下吧</div>
            ) : (
              <ul className="-mx-2">
                {vm.pendingList.slice(0, 5).map((item: PendingItem, i) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-primary/[0.05]"
                      onClick={() => navigate("/workflow/tasks")}
                    >
                      <span className={cn("shrink-0 rounded-lg px-2 py-0.5 text-[11.5px] font-semibold", toneForType(item.type, i))}>{item.type}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
                          <span className="truncate">{item.title}</span>
                          {item.urgent && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-rose-500/12 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                              <TriangleAlert className="size-3" />加急
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.applicant} · {item.time}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FocusCard>

          {/* 栏2 今日日程 */}
          <FocusCard>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                <CalendarDays className="size-[18px] text-primary" /> 今日日程
              </div>
              <span className="text-xs text-muted-foreground"><span className="tabular-nums">{vm.todaySchedule.length}</span> 场</span>
            </div>
            {vm.todaySchedule.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">今天没有日程安排</div>
            ) : (
              <ul>
                {vm.todaySchedule.map((item: ScheduleItem, i) => (
                  <li key={item.id} className="relative flex gap-3.5 pb-5 last:pb-1">
                    <div className="relative flex w-3.5 justify-center">
                      <span className={cn("mt-1 size-2.5 shrink-0 rounded-full border-[2.5px] bg-card", item.done ? "border-muted-foreground/50" : "border-primary ring-4 ring-primary/15")} />
                      {i < vm.todaySchedule.length - 1 && <span className="absolute top-3.5 bottom-[-14px] w-0.5 -translate-x-0 bg-border" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-[13px] font-semibold tabular-nums", item.done ? "text-muted-foreground" : "text-foreground")}>{item.time}</div>
                      <div className={cn("mt-0.5 text-[13.5px] font-medium", item.done && "text-muted-foreground")}>{item.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{item.place}</div>
                    </div>
                    <span className={cn("h-fit shrink-0 self-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", item.done ? "bg-muted text-muted-foreground" : "bg-primary/12 text-primary")}>
                      {item.done ? "已结束" : "待开始"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </FocusCard>

          {/* 栏3 出勤打卡 */}
          <FocusCard>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                <AlarmClockCheck className="size-[18px] text-primary" /> 出勤打卡
              </div>
              <span className={cn("text-xs font-medium", vm.hasCheckIn ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{vm.hasCheckIn ? "正常" : "待打卡"}</span>
            </div>
            <div className="flex items-stretch gap-3">
              <div className="flex-1 rounded-2xl bg-primary/[0.05] py-4 text-center">
                <div className="text-xs text-muted-foreground">上班</div>
                <div className={cn("my-1 text-2xl font-bold tabular-nums", vm.hasCheckIn ? "text-primary" : "text-muted-foreground/50")}>{vm.checkInDisplay}</div>
                <div className={cn("text-[11px] font-semibold", vm.hasCheckIn ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{vm.hasCheckIn ? "已打卡" : "待打卡"}</div>
              </div>
              <div className="w-px self-stretch bg-border" />
              <div className="flex-1 rounded-2xl bg-primary/[0.05] py-4 text-center">
                <div className="text-xs text-muted-foreground">下班</div>
                <div className={cn("my-1 text-2xl font-bold tabular-nums", vm.hasCheckOut ? "text-primary" : "text-muted-foreground/50")}>{vm.checkOutDisplay}</div>
                <div className={cn("text-[11px] font-semibold", vm.hasCheckOut ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{vm.hasCheckOut ? "已打卡" : "待打卡"}</div>
              </div>
            </div>
            <Button
              disabled={vm.checking}
              onClick={() => void vm.handleCheck()}
              className="mt-4 w-full gap-2 rounded-full bg-gradient-to-br from-primary to-primary/85 shadow-md shadow-primary/25 hover:brightness-105"
            >
              <CheckCircle2 className="size-4" /> {vm.hasCheckIn ? "下班打卡" : "上班打卡"}
            </Button>
            <div className="mt-4 flex items-center gap-3.5">
              <AttendRing days={vm.metrics.monthAttendanceDays} />
              <div className="text-[12.5px] leading-relaxed text-muted-foreground">
                本月出勤 <b className="tabular-nums text-foreground">{vm.metrics.monthAttendanceDays}</b> 天
                <br />今日会议 <b className="tabular-nums text-foreground">{vm.metrics.todayMeetings}</b> 场
              </div>
            </div>
          </FocusCard>
        </div>
      </section>

      {/* KPI 四项 */}
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {vm.stats.map((stat) => (
          <button
            key={stat.key}
            type="button"
            onClick={() => navigate(stat.path)}
            className="flex items-center gap-3.5 rounded-3xl border border-border/60 bg-card p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", KPI_TONE[stat.key])}>
              <stat.icon className="size-[22px]" />
            </span>
            <span>
              <span className="flex items-baseline gap-1">
                <span className="text-2xl font-bold tabular-nums leading-none">{stat.value}</span>
                <span className="text-xs font-medium text-muted-foreground">{stat.unit}</span>
              </span>
              <span className="mt-1.5 block text-[12.5px] text-muted-foreground">{stat.label}</span>
            </span>
          </button>
        ))}
      </section>

      {/* 下部两卡 */}
      <section className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <FocusCard>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <TrendingUp className="size-[18px] text-primary" /> 近 7 日审批处理量
            </div>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <i className="inline-block h-[3px] w-4 rounded-sm bg-primary" />处理量（件）
            </span>
          </div>
          <WeekChart data={vm.weekData} max={vm.weekMax} />
        </FocusCard>

        <FocusCard>
          <div className="mb-4 flex items-center gap-2 text-[15px] font-semibold">
            <Zap className="size-[18px] text-primary" /> 快捷发起
          </div>
          <div className="grid grid-cols-3 gap-3">
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => navigate("/workflow/start")}
                className="flex flex-col items-center gap-2 rounded-2xl border border-transparent p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-border/60 hover:bg-primary/[0.05]"
              >
                <span className={cn("grid size-11 place-items-center rounded-2xl", action.tone)}>
                  <action.icon className="size-[22px]" />
                </span>
                <span className="text-center text-xs text-muted-foreground">{action.label}</span>
              </button>
            ))}
          </div>
        </FocusCard>
      </section>

      {/* 公告通知 */}
      <FocusCard>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <Megaphone className="size-[18px] text-primary" /> 公告通知
          </div>
          <button type="button" className="inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-primary" onClick={() => navigate("/announcement")}>
            全部公告 <ChevronRight className="size-3.5" />
          </button>
        </div>
        {vm.announcements.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">暂无公告</div>
        ) : (
          <ul className="-mx-2">
            {vm.announcements.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-primary/[0.05]"
                  onClick={() => navigate("/announcement")}
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", item.top ? "bg-primary" : "bg-muted-foreground/30")} />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-medium">{item.title}</span>
                    {item.top && <span className="shrink-0 rounded-md bg-rose-500/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-rose-600 dark:text-rose-300">置顶</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{item.dept} · <span className="tabular-nums">{item.date}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </FocusCard>
    </div>
  )
}

/** KPI 图标底色（明暗都清晰） */
const KPI_TONE: Record<string, string> = {
  pending: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
  meeting: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  attendance: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  announcement: "bg-orange-500/12 text-orange-600 dark:text-orange-300",
}

/** 本月出勤进度环（按 22 个工作日估算，仅视觉参考） */
function AttendRing({ days }: { days: number }) {
  const pct = Math.max(0, Math.min(1, days / 22))
  const r = 32
  const circ = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 80 80" className="size-16 shrink-0">
      <circle cx="40" cy="40" r={r} fill="none" className="stroke-muted" strokeWidth={8} />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        className="stroke-primary"
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct)}
        transform="rotate(-90 40 40)"
      />
      <text x="40" y="38" textAnchor="middle" className="fill-foreground tabular-nums" fontSize={19} fontWeight={650}>
        {days}
      </text>
      <text x="40" y="53" textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
        天
      </text>
    </svg>
  )
}
