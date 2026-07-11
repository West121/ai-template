/**
 * AI 助手关键纯逻辑用例：confirm 状态机 / chart 数据映射 / markdown 渲染。
 */
import { describe, expect, it } from "vitest"
import { mdToHtml } from "./markdown"
import { CONFIRM_INITIAL, confirmReducer, type ConfirmCardState } from "./cards/confirm-machine"
import { barLayout, donutSegments, isChartEmpty, lineLayout, niceMax, chartColor } from "./cards/chart-math"

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

describe("chart 数据映射", () => {
  it("niceMax：加 headroom 后取 1/2/5×10^n", () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(9)).toBe(10)
    expect(niceMax(42)).toBe(50)
    expect(niceMax(100)).toBe(200) // 100*1.1=110 → 200
    expect(niceMax(180)).toBe(200)
  })

  it("barLayout：分组柱数量 = 类目×系列，柱高与值成比例、不越出绘图区", () => {
    const { rects, max } = barLayout(
      ["A", "B", "C"],
      [
        { name: "s1", data: [10, 20, 30] },
        { name: "s2", data: [5, 15, 25] },
      ],
    )
    expect(rects).toHaveLength(6)
    expect(max).toBe(50) // 30*1.1=33 → 50
    const a1 = rects.find((r) => r.category === "A" && r.seriesName === "s1")!
    const c1 = rects.find((r) => r.category === "C" && r.seriesName === "s1")!
    expect(c1.h).toBeGreaterThan(a1.h)
    expect(c1.h / a1.h).toBeCloseTo(3, 5) // 30/10
    for (const r of rects) {
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.y + r.h).toBeLessThanOrEqual(180)
    }
  })

  it("lineLayout：x 均匀分布、y 越大值越小（SVG 坐标向下）", () => {
    const { points } = lineLayout(["1月", "2月", "3月"], [{ name: "s", data: [10, 30, 20] }])
    const [p1, p2, p3] = points[0]
    expect(p2.x - p1.x).toBeCloseTo(p3.x - p2.x, 5)
    expect(p2.y).toBeLessThan(p1.y) // 30 > 10 → y 更小（更高）
    expect(p3.y).toBeLessThan(p1.y)
    expect(p3.y).toBeGreaterThan(p2.y)
  })

  it("donutSegments：dash 总长=周长、offset 顺时针累加、percent 后端优先", () => {
    const C = 100
    const segs = donutSegments(
      [
        { name: "a", value: 50 },
        { name: "b", value: 30, percent: 33.3 },
        { name: "c", value: 20 },
      ],
      C,
    )
    expect(segs.map((s) => s.dash).reduce((x, y) => x + y, 0)).toBeCloseTo(C, 5)
    expect(segs[0].offset).toBe(-0)
    expect(segs[1].offset).toBeCloseTo(-50, 5)
    expect(segs[2].offset).toBeCloseTo(-80, 5)
    expect(segs[0].percent).toBe(50)
    expect(segs[1].percent).toBe(33.3) // 后端给的优先
    // 全 0 → 空数组（组件呈现空态）
    expect(donutSegments([{ name: "x", value: 0 }], C)).toEqual([])
  })

  it("chartColor 循环 --chart-1..5；isChartEmpty 判空", () => {
    expect(chartColor(0)).toBe("var(--chart-1)")
    expect(chartColor(5)).toBe("var(--chart-1)")
    expect(chartColor(6)).toBe("var(--chart-2)")
    expect(isChartEmpty([])).toBe(true)
    expect(isChartEmpty([{ data: [0, 0] }])).toBe(true)
    expect(isChartEmpty([{ data: [0, 1] }])).toBe(false)
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
