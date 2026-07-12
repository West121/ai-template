// @vitest-environment jsdom
/**
 * chart 卡迁 shadcn/recharts 后的渲染冒烟（丹青 ai-chart-shadcn §5）：
 *  - 三种图（bar/line/pie donut）均挂载出图、不白屏
 *  - 月份类目：轴显「1月/2月/3月」（不再截断成「2026-…」）
 *  - 空数据 / 非法 chartType → 「暂无数据」，不抛
 *  - 下钻回调：pie 扇区点击 → executeReport(reportCode,{paramName:类目}) → appendAssistantParts
 * 说明：jsdom 无布局，靠 shadcn ChartContainer 的 initialDimension 让 recharts 出图；
 * prefers-reduced-motion 置真 → 关入场动画，渲染确定。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { AiChatActionsContext } from "../chat-actions"
import type { AiChartCard } from "../types"
import { ChartCard } from "./chart-card"

const executeReport = vi.hoisted(() => vi.fn(async () => ({ data: { title: "下钻结果", columns: [], rows: [] } })))
vi.mock("../api", () => ({ executeReport }))

beforeAll(() => {
  // recharts 靠 ResizeObserver 量尺寸；jsdom 无布局 → 桩里主动回报 320×200，让图真出图
  class RO {
    cb: (entries: unknown[]) => void
    constructor(cb: (entries: unknown[]) => void) {
      this.cb = cb
    }
    observe(el: Element) {
      this.cb([{ target: el, contentRect: { width: 320, height: 200, top: 0, left: 0, right: 320, bottom: 200, x: 0, y: 0 } }])
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO)
  // reduce-motion 置真 → recharts 关动画，渲染确定
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
})
afterEach(() => {
  cleanup()
  executeReport.mockClear()
})
vi.spyOn(console, "error").mockImplementation(() => {})
vi.spyOn(console, "warn").mockImplementation(() => {})

const append = vi.fn()
const renderCard = (card: AiChartCard) =>
  render(
    <AiChatActionsContext.Provider value={{ appendAssistantParts: append }}>
      <ChartCard card={card} />
    </AiChatActionsContext.Provider>,
  )

const monthBar: AiChartCard = {
  type: "chart",
  chartType: "bar",
  title: "本月审批量（按流程）",
  categories: ["2026-01", "2026-02", "2026-03"],
  series: [
    { name: "发起量", data: [12, 20, 15] },
    { name: "办结量", data: [10, 18, 14] },
  ],
  drill: { reportCode: "approval_by_month", paramName: "month" },
}

describe("chart 卡 recharts 渲染冒烟", () => {
  it("bar：出图 + 月份轴显「1月/2月/3月」不截断 + 图例", async () => {
    const { container } = renderCard(monthBar)
    expect(await screen.findByText("本月审批量（按流程）")).toBeTruthy()
    expect(container.querySelector(".recharts-wrapper")).toBeTruthy()
    expect(container.querySelector(".recharts-bar")).toBeTruthy()
    // 核心痛点：月份友好化，绝无「2026-…」截断
    expect(screen.getByText("1月")).toBeTruthy()
    expect(screen.getByText("3月")).toBeTruthy()
    expect(screen.queryByText(/2026-…|2026-…/)).toBeNull()
    // 图例保留（含系列原名）
    expect(screen.getByText("发起量")).toBeTruthy()
    expect(screen.getByText("办结量")).toBeTruthy()
  })

  it("line：AreaChart 出图 + 月份轴", async () => {
    const { container } = renderCard({ ...monthBar, chartType: "line", title: "趋势", drill: undefined })
    await screen.findByText("趋势")
    expect(container.querySelector(".recharts-area")).toBeTruthy()
    expect(screen.getByText("2月")).toBeTruthy()
  })

  it("pie(donut)：出图 + 中心合计 + 图例 percent + 扇区点击下钻", async () => {
    const card: AiChartCard = {
      type: "chart",
      chartType: "pie",
      title: "办件状态占比",
      series: [
        { name: "已办结", data: [60], percent: 60 },
        { name: "进行中", data: [40], percent: 40 },
      ],
      drill: { reportCode: "status_detail", paramName: "status" },
    }
    const { container } = renderCard(card)
    await screen.findByText("办件状态占比")
    expect(container.querySelector(".recharts-pie")).toBeTruthy()
    // 中心合计（20/11 字号，随容器不放大）
    expect(screen.getByText("100")).toBeTruthy()
    expect(screen.getByText("合计")).toBeTruthy()
    // 图例带后端 percent
    expect(screen.getByText("60%")).toBeTruthy()
    // 下钻回调：点第一个扇区（已办结）→ executeReport(reportCode,{status:类目})
    const sector = container.querySelector(".recharts-sector") as Element
    expect(sector).toBeTruthy()
    fireEvent.click(sector)
    await waitFor(() => expect(executeReport).toHaveBeenCalledWith("status_detail", { status: "已办结" }))
    await waitFor(() => expect(append).toHaveBeenCalled())
  })

  it("空数据 → 「暂无数据」不白屏", () => {
    renderCard({ type: "chart", chartType: "bar", title: "空", categories: [], series: [] })
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("非法 chartType → 「暂无数据」不抛", () => {
    renderCard({ type: "chart", chartType: "radar" as unknown as "bar", title: "怪图", categories: ["A"], series: [{ name: "x", data: [1] }] })
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })
})
