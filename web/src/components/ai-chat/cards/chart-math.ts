/**
 * 图表卡纯布局算术（丹青 §3.5，逻辑坐标 320×180，node 可测）。
 * 组件只做 SVG 描画；数据 → 几何映射全部在此，保证可单测。
 */

export const CHART_W = 320
export const CHART_H = 180
const PAD_L = 28
const PAD_R = 8
const PAD_T = 10
const PAD_B = 22

export interface BarRect {
  x: number
  y: number
  w: number
  h: number
  /** 系列序号（取色 chart-{(i%5)+1}） */
  seriesIndex: number
  value: number
  category: string
  seriesName: string
}

/** 取「好看的」纵轴上限：最大值加 ~10% headroom 后向上取整到 1/2/5×10^n */
export function niceMax(maxValue: number): number {
  if (maxValue <= 0) return 1
  const target = maxValue * 1.1
  const pow = 10 ** Math.floor(Math.log10(target))
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= target) return m * pow
  }
  return 10 * pow
}

/** 柱状布局：分组柱（单系列即每组一柱） */
export function barLayout(
  categories: string[],
  series: { name: string; data: number[] }[],
): { rects: BarRect[]; max: number } {
  const plotW = CHART_W - PAD_L - PAD_R
  const plotH = CHART_H - PAD_T - PAD_B
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.data)))
  const bandW = categories.length > 0 ? plotW / categories.length : plotW
  const groupW = bandW * 0.6
  const barW = series.length > 0 ? groupW / series.length : groupW
  const rects: BarRect[] = []
  categories.forEach((cat, ci) => {
    series.forEach((s, si) => {
      const v = s.data[ci] ?? 0
      const h = (v / max) * plotH
      rects.push({
        x: PAD_L + ci * bandW + (bandW - groupW) / 2 + si * barW,
        y: PAD_T + plotH - h,
        w: Math.max(1, barW - 2),
        h,
        seriesIndex: si,
        value: v,
        category: cat,
        seriesName: s.name,
      })
    })
  })
  return { rects, max }
}

export interface LinePoint {
  x: number
  y: number
  value: number
  category: string
}

/** 折线布点：每系列一组点（x 均匀分布、y 按 niceMax 归一） */
export function lineLayout(
  categories: string[],
  series: { name: string; data: number[] }[],
): { points: LinePoint[][]; max: number } {
  const plotW = CHART_W - PAD_L - PAD_R
  const plotH = CHART_H - PAD_T - PAD_B
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.data)))
  const n = Math.max(1, categories.length)
  const step = n > 1 ? plotW / (n - 1) : 0
  const points = series.map((s) =>
    categories.map((cat, ci) => {
      const v = s.data[ci] ?? 0
      return {
        x: PAD_L + (n > 1 ? ci * step : plotW / 2),
        y: PAD_T + (1 - v / max) * plotH,
        value: v,
        category: cat,
      }
    }),
  )
  return { points, max }
}

/** 坐标轴几何（bar/line 共用）：基线 + 网格 y 与刻度值 */
export function axisLayout(max: number): { baselineY: number; grid: { y: number; value: number }[]; plot: { l: number; t: number; r: number; b: number } } {
  const plotH = CHART_H - PAD_T - PAD_B
  const grid = [0.5, 1].map((f) => ({ y: PAD_T + (1 - f) * plotH, value: max * f }))
  return {
    baselineY: PAD_T + plotH,
    grid,
    plot: { l: PAD_L, t: PAD_T, r: CHART_W - PAD_R, b: PAD_T + plotH },
  }
}

export interface DonutSegment {
  /** stroke-dasharray 的实段长 */
  dash: number
  /** stroke-dashoffset（周长坐标系，顺时针从 12 点起） */
  offset: number
  /** 占比 0-100（用于图例；后端 percent 优先） */
  percent: number
  value: number
  name: string
  seriesIndex: number
}

/**
 * 环形图段（丹青 §3.5.4：单 <circle> + dasharray 叠段）。
 * values 全 0/空 → 返回空数组（组件呈现空态）。circumference = 2πr。
 */
export function donutSegments(
  items: { name: string; value: number; percent?: number }[],
  circumference: number,
): DonutSegment[] {
  const total = items.reduce((sum, it) => sum + Math.max(0, it.value), 0)
  if (total <= 0) return []
  let acc = 0
  return items.map((it, i) => {
    const v = Math.max(0, it.value)
    const frac = v / total
    const seg: DonutSegment = {
      dash: frac * circumference,
      offset: -acc * circumference,
      percent: it.percent ?? Math.round(frac * 1000) / 10,
      value: v,
      name: it.name,
      seriesIndex: i,
    }
    acc += frac
    return seg
  })
}

/** 图表分类色（严格 --chart-1..5 循环，禁止硬编码十六进制） */
export function chartColor(i: number): string {
  return `var(--chart-${(i % 5) + 1})`
}

/** 空数据判定：无系列或全部值 ≤0 */
export function isChartEmpty(series: { data: number[] }[]): boolean {
  return series.length === 0 || series.every((s) => s.data.every((v) => !(v > 0)))
}
