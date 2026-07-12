/**
 * 图表卡数据映射（丹青 ai-chart-shadcn §4，纯函数可测）。
 * recharts 接管几何/坐标轴/响应式；此文件只保留 AiChartSeries → recharts 行/扇区数据 的映射、
 * 分类色（--chart-1..5）、空判定、类目 tick 友好化。几何算术（barLayout/lineLayout/axisLayout/
 * donutSegments/niceMax）已随迁移删除。
 */

/** 图表分类色（严格 --chart-1..5 循环，禁止硬编码十六进制） */
export function chartColor(i: number): string {
  return `var(--chart-${(i % 5) + 1})`
}

/** 空数据判定：无系列或全部值 ≤0（series[i].data 非数组按 [] 兜底，不炸） */
export function isChartEmpty(series: { data?: number[] }[]): boolean {
  return (
    series.length === 0 ||
    series.every((s) => (Array.isArray(s.data) ? s.data : []).every((v) => !(v > 0)))
  )
}

/**
 * 类目 tick 友好化（§3.1）：时间维压成「N月 / M/D / 年」，分类维原样返回（绝不 slice 截断）。
 * 只作用于坐标轴显示；tooltip 用原始 category，永远显全（如「2026-01」）。
 */
export function formatCategoryTick(v: string): string {
  if (/^\d{4}-\d{2}$/.test(v)) return `${Number(v.slice(5, 7))}月` // 2026-01 → 1月
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}` // 2026-01-05 → 1/5
  if (/^\d{4}$/.test(v)) return `${v}年` // 2026 → 2026年
  return v // 分类维：原样，不截断
}

export interface ChartRow {
  category: string
  [seriesKey: string]: string | number
}

/**
 * bar/line 行数据（§4.2）：每个类目一行，系列值铺成 s0/s1/… 列。
 * series[i].data 非数组或缺值 → 0，绝不 undefined 越界。
 */
export function toBarLineData(categories: string[], series: { name?: string; data?: number[] }[]): ChartRow[] {
  return categories.map((cat, ci) => {
    const row: ChartRow = { category: cat }
    series.forEach((s, i) => {
      const data = Array.isArray(s.data) ? s.data : []
      row[`s${i}`] = data[ci] ?? 0
    })
    return row
  })
}

export interface PieDatum {
  name: string
  value: number
  percent?: number
  fill: string
}

/** pie(donut)（§4.3）：每系列取 data[0] 当一个扇区（现契约：系列即扇区），负值夹到 0。 */
export function toPieData(series: { name: string; data?: number[]; percent?: number }[]): PieDatum[] {
  return series.map((s, i) => {
    const data = Array.isArray(s.data) ? s.data : []
    return { name: s.name, value: Math.max(0, data[0] ?? 0), percent: s.percent, fill: chartColor(i) }
  })
}
