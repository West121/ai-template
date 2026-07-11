/**
 * chart 卡（§3.5）：纯手写 SVG bar|line|pie(donut)，颜色严格 --chart-1..5 循环，零图表依赖。
 * viewBox 320×180 逻辑坐标随面板宽缩放；原生 <title> 做悬浮显值；图例文字兜底（色弱/灰度可读）。
 * 几何映射在 chart-math.ts（纯函数，可测）。
 */
import { BarChart3 } from "lucide-react"
import type { AiChartCard, AiChartSeries } from "../types"
import {
  axisLayout,
  barLayout,
  CHART_H,
  CHART_W,
  chartColor,
  donutSegments,
  isChartEmpty,
  lineLayout,
} from "./chart-math"

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

function Axis({ max }: { max: number }) {
  const a = axisLayout(max)
  return (
    <>
      {a.grid.map((g) => (
        <g key={g.value}>
          <line x1={a.plot.l} x2={a.plot.r} y1={g.y} y2={g.y} stroke="var(--border)" strokeDasharray="2 3" />
          <text x={a.plot.l - 4} y={g.y + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
            {g.value}
          </text>
        </g>
      ))}
      <line x1={a.plot.l} x2={a.plot.r} y1={a.baselineY} y2={a.baselineY} stroke="var(--border)" />
      <text x={a.plot.l - 4} y={a.baselineY + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
        0
      </text>
    </>
  )
}

function CategoryLabels({ categories }: { categories: string[] }) {
  const a = axisLayout(1)
  const bandW = (a.plot.r - a.plot.l) / Math.max(1, categories.length)
  // 类目多时隔项显示，避免挤压
  const step = categories.length > 6 ? 2 : 1
  return (
    <>
      {categories.map((c, i) =>
        i % step === 0 ? (
          <text
            key={i}
            x={a.plot.l + i * bandW + bandW / 2}
            y={CHART_H - 8}
            textAnchor="middle"
            fontSize={10}
            fill="var(--muted-foreground)"
          >
            {c.length > 6 ? `${c.slice(0, 5)}…` : c}
            <title>{c}</title>
          </text>
        ) : null,
      )}
    </>
  )
}

function BarChart({ categories, series }: { categories: string[]; series: AiChartSeries[] }) {
  const { rects, max } = barLayout(categories, series)
  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="xMidYMid meet" className="w-full" role="img">
      <Axis max={max} />
      <CategoryLabels categories={categories} />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={2} fill={chartColor(r.seriesIndex)} className="transition-opacity hover:opacity-80">
          <title>{`${r.category} · ${r.seriesName}：${r.value}`}</title>
        </rect>
      ))}
    </svg>
  )
}

function LineChart({ categories, series }: { categories: string[]; series: AiChartSeries[] }) {
  const { points, max } = lineLayout(categories, series)
  const a = axisLayout(max)
  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="xMidYMid meet" className="w-full" role="img">
      <Axis max={max} />
      <CategoryLabels categories={categories} />
      {points.map((pts, si) => {
        const color = chartColor(si)
        const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ")
        // 主系列面积（首个系列）
        const area =
          si === 0 && pts.length > 1
            ? `M ${pts[0].x},${a.baselineY} ${pts.map((p) => `L ${p.x},${p.y}`).join(" ")} L ${pts[pts.length - 1].x},${a.baselineY} Z`
            : null
        return (
          <g key={si}>
            {area && <path d={area} fill={color} fillOpacity={0.12} />}
            <polyline points={polyline} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((p, pi) => (
              <circle key={pi} cx={p.x} cy={p.y} r={2.5} fill={color}>
                <title>{`${p.category} · ${series[si].name}：${p.value}`}</title>
              </circle>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function DonutChart({ series }: { series: AiChartSeries[] }) {
  const R = 62
  const strokeW = 24
  const r = R - strokeW / 2
  const circumference = 2 * Math.PI * r
  const items = series.map((s) => ({ name: s.name, value: s.data[0] ?? 0, percent: s.percent }))
  const segments = donutSegments(items, circumference)
  const total = items.reduce((sum, it) => sum + Math.max(0, it.value), 0)
  const cx = CHART_W / 2
  const cy = CHART_H / 2
  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="xMidYMid meet" className="w-full" role="img">
      {/* 从 12 点顺时针起：旋转 -90° */}
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {segments.map((seg) => (
          <circle
            key={seg.name}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={chartColor(seg.seriesIndex)}
            strokeWidth={strokeW}
            strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
            strokeDashoffset={seg.offset}
            className="transition-opacity hover:opacity-80"
          >
            <title>{`${seg.name}：${seg.value}（${seg.percent}%）`}</title>
          </circle>
        ))}
      </g>
      {/* 段间细缝：叠一圈 card 色描边圆点省略（MVP）；中心合计 */}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={16} fontWeight={600} fill="var(--foreground)">
        {total}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
        合计
      </text>
    </svg>
  )
}

export function ChartCard({ card }: { card: AiChartCard }) {
  const empty = isChartEmpty(card.series)
  const typeLabel = card.chartType === "bar" ? "柱状图" : card.chartType === "line" ? "折线图" : "环形图"
  const legendItems =
    card.chartType === "pie"
      ? card.series.map((s, i) => ({
          name: s.name,
          index: i,
          percent: s.percent ?? undefined,
        }))
      : card.series.map((s, i) => ({ name: s.name, index: i }))

  return (
    <div className="w-full min-w-0 rounded-xl border bg-card p-3.5 shadow-sm" role="img" aria-label={`${card.title}，${typeLabel}`}>
      <div className="mb-2 flex items-center gap-2">
        <BarChart3 className="size-4 text-primary" />
        <p className="text-sm font-semibold">{card.title}</p>
      </div>
      {empty ? (
        <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">暂无数据</div>
      ) : card.chartType === "bar" ? (
        <BarChart categories={card.categories ?? []} series={card.series} />
      ) : card.chartType === "line" ? (
        <LineChart categories={card.categories ?? []} series={card.series} />
      ) : (
        <DonutChart series={card.series} />
      )}
      {!empty && <Legend items={legendItems} />}
    </div>
  )
}
