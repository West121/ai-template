/**
 * AI 助手关键纯逻辑用例：confirm 状态机 / chart 数据映射 / markdown 渲染。
 */
import { describe, expect, it } from "vitest"
import { mdToHtml } from "./markdown"
import { CONFIRM_INITIAL, confirmReducer, type ConfirmCardState } from "./cards/confirm-machine"
import { chartColor, formatCategoryTick, isChartEmpty, toBarLineData, toPieData } from "./cards/chart-math"

/* ---------------- confirm 状态机 ---------------- */

describe("confirm 状态机", () => {
  const step = (s: ConfirmCardState, ...events: Parameters<typeof confirmReducer>[1][]) =>
    events.reduce(confirmReducer, s)

  it("idle → CONFIRM → submitting → SUCCESS → done（带结果）", () => {
    const s = step(CONFIRM_INITIAL, { type: "CONFIRM" }, { type: "SUCCESS", message: "已执行", resultLink: "/x" })
    expect(s).toEqual({ state: "done", resultMessage: "已执行", resultLink: "/x" })
  })

  it("submitting → FAILURE(expired) → expired；普通 FAILURE → 回 idle 可重试", () => {
    expect(step(CONFIRM_INITIAL, { type: "CONFIRM" }, { type: "FAILURE", expired: true }).state).toBe("expired")
    const retryable = step(CONFIRM_INITIAL, { type: "CONFIRM" }, { type: "FAILURE" })
    expect(retryable.state).toBe("idle")
    expect(retryable.error).toBeTruthy()
    // 失败后可再次 CONFIRM
    expect(confirmReducer(retryable, { type: "CONFIRM" }).state).toBe("submitting")
  })

  it("idle → CANCEL → cancelled；终态不再迁移", () => {
    const cancelled = step(CONFIRM_INITIAL, { type: "CANCEL" })
    expect(cancelled.state).toBe("cancelled")
    expect(confirmReducer(cancelled, { type: "CONFIRM" }).state).toBe("cancelled")
    const done = step(CONFIRM_INITIAL, { type: "CONFIRM" }, { type: "SUCCESS" })
    expect(confirmReducer(done, { type: "CANCEL" }).state).toBe("done")
    const expired = step(CONFIRM_INITIAL, { type: "CONFIRM" }, { type: "FAILURE", expired: true })
    expect(confirmReducer(expired, { type: "CONFIRM" }).state).toBe("expired")
  })

  it("submitting 中 CANCEL 无效（防执行中取消造成状态错乱）", () => {
    const submitting = step(CONFIRM_INITIAL, { type: "CONFIRM" })
    expect(confirmReducer(submitting, { type: "CANCEL" }).state).toBe("submitting")
  })
})

/* ---------------- chart 数据映射 ---------------- */

describe("chart 数据映射（recharts 迁移）", () => {
  it("formatCategoryTick：时间维压成 月/日/年，分类维原样不截断", () => {
    expect(formatCategoryTick("2026-01")).toBe("1月") // 核心痛点：不再 2026-…
    expect(formatCategoryTick("2026-12")).toBe("12月")
    expect(formatCategoryTick("2026-01-05")).toBe("1/5")
    expect(formatCategoryTick("2026")).toBe("2026年")
    expect(formatCategoryTick("研发部")).toBe("研发部") // 分类维原样
    expect(formatCategoryTick("行政管理中心（较长）")).toBe("行政管理中心（较长）") // 绝不 slice
  })

  it("toBarLineData：类目为行、系列铺成 s0/s1 列，缺值/非数组 → 0", () => {
    const rows = toBarLineData(
      ["2026-01", "2026-02", "2026-03"],
      [
        { name: "发起量", data: [12, 20, 15] },
        { name: "办结量", data: [10, 18, 14] },
      ],
    )
    expect(rows).toEqual([
      { category: "2026-01", s0: 12, s1: 10 },
      { category: "2026-02", s0: 20, s1: 18 },
      { category: "2026-03", s0: 15, s1: 14 },
    ])
    // 系列 data 短于类目 / 非数组 → 0，不越界不抛
    const guard = toBarLineData(["A", "B"], [{ name: "x", data: [7] }, { name: "y" }])
    expect(guard).toEqual([
      { category: "A", s0: 7, s1: 0 },
      { category: "B", s0: 0, s1: 0 },
    ])
  })

  it("toPieData：每系列取 data[0] 当扇区，percent 透传、负值夹 0、fill 走 --chart-N", () => {
    const pie = toPieData([
      { name: "已办结", data: [60], percent: 60 },
      { name: "进行中", data: [40], percent: 40 },
    ])
    expect(pie).toEqual([
      { name: "已办结", value: 60, percent: 60, fill: "var(--chart-1)" },
      { name: "进行中", value: 40, percent: 40, fill: "var(--chart-2)" },
    ])
    // 负值夹 0、data 缺失 → 0
    expect(toPieData([{ name: "x", data: [-5] }, { name: "y" }])).toEqual([
      { name: "x", value: 0, percent: undefined, fill: "var(--chart-1)" },
      { name: "y", value: 0, percent: undefined, fill: "var(--chart-2)" },
    ])
  })

  it("chartColor 循环 --chart-1..5；isChartEmpty 判空（data 非数组按空）", () => {
    expect(chartColor(0)).toBe("var(--chart-1)")
    expect(chartColor(5)).toBe("var(--chart-1)")
    expect(chartColor(6)).toBe("var(--chart-2)")
    expect(isChartEmpty([])).toBe(true)
    expect(isChartEmpty([{ data: [0, 0] }])).toBe(true)
    expect(isChartEmpty([{ data: [0, 1] }])).toBe(false)
    expect(isChartEmpty([{} as { data?: number[] }])).toBe(true) // data 缺失 → 空
  })
})

/* ---------------- markdown 渲染 ---------------- */

describe("mdToHtml", () => {
  it("段落 / 加粗 / 行内代码 / 链接（仅放行站内与 http(s)）", () => {
    expect(mdToHtml("你好 **世界** `code`")).toBe("<p>你好 <strong>世界</strong> <code>code</code></p>")
    expect(mdToHtml("[待办](/workflow/tasks)")).toBe('<p><a href="/workflow/tasks">待办</a></p>')
    expect(mdToHtml("[x](javascript:alert(1))")).not.toContain("<a") // 危险协议绝不产出链接
  })

  it("标题 / 列表 / 代码块", () => {
    expect(mdToHtml("## 标题")).toBe("<h2>标题</h2>")
    expect(mdToHtml("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>")
    expect(mdToHtml("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>")
    expect(mdToHtml("```\n<x>\n```")).toBe("<pre><code>&lt;x&gt;</code></pre>")
  })

  it("表格包 .md-table-wrap 横滚容器；HTML 转义", () => {
    const html = mdToHtml("| A | B |\n| --- | --- |\n| 1 | <b>2</b> |")
    expect(html).toContain('<div class="md-table-wrap"><table>')
    expect(html).toContain("<th>A</th>")
    expect(html).toContain("&lt;b&gt;2&lt;/b&gt;")
    expect(mdToHtml("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")
  })

  it("空输入回空串", () => {
    expect(mdToHtml("")).toBe("")
    expect(mdToHtml(null)).toBe("")
  })
})
