/**
 * chart 卡（§3.5，丹青 ai-chart-shadcn）：内部实现从纯手写 SVG 迁到 shadcn/ui 官方图表（recharts）。
 * 卡壳 / 下钻链路 / 路由（CardRouter/PartRouter → <ChartCard card>）零改动；仅换图形内核。
 * - bar → <BarChart>；line → <AreaChart>（首系列面积）；pie → <PieChart> donut（中心合计）。
 * - 类目标签靠 XAxis tickFormatter 友好化（月/日/年，绝不粗暴截断），tooltip 永远显全类目。
 * - 颜色一律 var(--chart-1..5)（light/dark 两态由 index.css 定义）；ChartContainer 注入 --color-sN。
 * - 下钻：bar 点类目 / pie 点扇区 → onPick(category) → report_execute → 结果 list 卡追加进消息流。
 * 防白屏：空/非法 chartType/series 缺失 → 「暂无数据」不抛；组件仍在 chat-view 的 CardBoundary 内。
 */
import { useState, type ComponentProps } from "react"
import { BarChart3, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { executeReport } from "../api"
import { reportResultToListPart } from "../protocol"
import { useAiChatActions } from "../chat-actions"
import type { AiChartCard } from "../types"
import { chartColor, formatCategoryTick, isChartEmpty, toBarLineData, toPieData } from "./chart-math"

/** 图例（pie 带后端 percent；bar/line 仅色块+名）。保留自绘，色块直取 --chart-N 保证与图一致。 */
function Legend({ items }: { items: { name: string; index: number; percent?: number }[] }) {
  return (
    <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
      {items.map((it) => (
        <li key={it.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2.5 rounded-[3px]" style={{ background: chartColor(it.index) }} />
          <span className="text-foreground">{it.name}</span>
          {it.percent != null && <span>{it.percent}%</span>}
        </li>
      ))}
    </ul>
  )
}

export function ChartCard({ card }: { card: AiChartCard }) {
  const actions = useAiChatActions()
  const [drilling, setDrilling] = useState<string | null>(null)

  // 防白屏降级 guard（§2）：series/categories 非数组按 [] 兜底
  const series = Array.isArray(card.series) ? card.series : []
  const categories = Array.isArray(card.categories) ? card.categories : []
  const known = card.chartType === "bar" || card.chartType === "line" || card.chartType === "pie"
  const empty = !known || isChartEmpty(series) || (card.chartType !== "pie" && categories.length === 0)
  const typeLabel =
    card.chartType === "bar" ? "柱状图" : card.chartType === "line" ? "折线图" : card.chartType === "pie" ? "环形图" : "图表"

  /** 批C 下钻：点击类目/扇区 → report_execute → 结果 list 卡追加进消息流（AiChatActions 上下文） */
  const drill = card.drill
  const onPick =
    drill && !drilling
      ? (category: string) => {
          void (async () => {
            setDrilling(category)
            try {
              const res = await executeReport(drill.reportCode, { [drill.paramName]: category })
              if (actions) {
                actions.appendAssistantParts(`已按「${category}」下钻：`, [reportResultToListPart(res.data)])
              } else {
                toast.info("下钻结果无法追加（不在对话面板内）")
              }
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "下钻查询失败")
            } finally {
              setDrilling(null)
            }
          })()
        }
      : undefined

  // ChartConfig：系列名任意中文 → index key s0..s4（稳定），label 存原名，color 走 --chart-N。
  // ChartContainer 据此注入 --color-s0…（light/dark 均指向 index.css 的 --chart-N）。
  const chartConfig: ChartConfig = Object.fromEntries(
    series.map((s, i) => [`s${i}`, { label: s.name, color: chartColor(i) }]),
  )
  const legendItems =
    card.chartType === "pie"
      ? series.map((s, i) => ({ name: s.name, index: i, percent: s.percent ?? undefined }))
      : series.map((s, i) => ({ name: s.name, index: i }))

  // 减弱动效：尊重系统 prefers-reduced-motion → 关闭 recharts 入场生长动画
  const reduceMotion =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
  const animate = !reduceMotion

  const barLineData = toBarLineData(categories, series)
  const pieData = toPieData(series)
  const pieTotal = pieData.reduce((sum, d) => sum + d.value, 0)
  const tilt = categories.length > 8 // 类目多且挤 → 倾斜 30° 保全文

  // 下钻事件：从 recharts 事件里取出 category 调 onPick(签名不变)
  const handleBarClick: ComponentProps<typeof BarChart>["onClick"] = onPick
    ? (state) => {
        const l = (state as { activeLabel?: string | number } | undefined)?.activeLabel
        if (l != null) onPick(String(l))
      }
    : undefined
  const handlePieClick: ComponentProps<typeof Pie>["onClick"] = onPick
    ? (d) => {
        const rec = d as { name?: string | number; payload?: { name?: string | number } }
        const name = rec?.name ?? rec?.payload?.name
        if (name != null) onPick(String(name))
      }
    : undefined

  return (
    <div
      className="w-full min-w-0 rounded-xl border bg-card p-3.5 shadow-sm"
      role="img"
      aria-label={`${card.title}，${typeLabel}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <BarChart3 className="size-4 text-primary" />
        <p className="text-sm font-semibold">{card.title}</p>
      </div>

      {empty ? (
        <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">暂无数据</div>
      ) : card.chartType === "bar" ? (
        <ChartContainer config={chartConfig} className="h-44 w-full">
          <BarChart accessibilityLayer data={barLineData} onClick={handleBarClick}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="category"
              tickFormatter={formatCategoryTick}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              minTickGap={8}
              angle={tilt ? -30 : 0}
              textAnchor={tilt ? "end" : "middle"}
              height={tilt ? 48 : 30}
            />
            <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <ChartTooltip cursor content={<ChartTooltipContent />} />
            {series.map((_, i) => (
              <Bar
                key={i}
                dataKey={`s${i}`}
                fill={`var(--color-s${i})`}
                radius={[3, 3, 0, 0]}
                isAnimationActive={animate}
                cursor={onPick ? "pointer" : undefined}
              />
            ))}
          </BarChart>
        </ChartContainer>
      ) : card.chartType === "line" ? (
        <ChartContainer config={chartConfig} className="h-44 w-full">
          <AreaChart accessibilityLayer data={barLineData}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="category"
              tickFormatter={formatCategoryTick}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              minTickGap={8}
              angle={tilt ? -30 : 0}
              textAnchor={tilt ? "end" : "middle"}
              height={tilt ? 48 : 30}
            />
            <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <ChartTooltip cursor content={<ChartTooltipContent />} />
            {series.map((_, i) => (
              <Area
                key={i}
                dataKey={`s${i}`}
                type="monotone"
                stroke={`var(--color-s${i})`}
                strokeWidth={2}
                fill={`var(--color-s${i})`}
                fillOpacity={i === 0 ? 0.12 : 0} // 首系列面积，其余仅线（对齐现状）
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={animate}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      ) : card.chartType === "pie" ? (
        <ChartContainer config={chartConfig} className="mx-auto h-52 w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={52}
              outerRadius={78}
              strokeWidth={2}
              paddingAngle={1}
              isAnimationActive={animate}
              onClick={handlePieClick}
            >
              {pieData.map((d, i) => (
                <Cell key={i} fill={d.fill} cursor={onPick ? "pointer" : undefined} />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (!viewBox || !("cx" in viewBox)) return null
                  const { cx, cy } = viewBox as { cx: number; cy: number }
                  return (
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan x={cx} y={cy - 2} className="fill-foreground" fontSize={20} fontWeight={600}>
                        {pieTotal}
                      </tspan>
                      <tspan x={cx} y={cy + 16} className="fill-muted-foreground" fontSize={11}>
                        合计
                      </tspan>
                    </text>
                  )
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      ) : (
        <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">暂无数据</div>
      )}

      {!empty && known && <Legend items={legendItems} />}
      {drilling && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin text-primary" /> 正在下钻「{drilling}」…
        </p>
      )}
    </div>
  )
}
