// @vitest-environment jsdom
/**
 * 「思考中」折叠态块渲染冒烟（丹青规范自检项）：进行中/完成收起可展开/失败态/无工具不留块。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ThinkingBlock } from "./thinking-block"
import type { ToolStatusItem } from "./api"

afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const steps4: ToolStatusItem[] = [
  { id: "1", displayName: "正在查询报表A", state: "done" },
  { id: "2", displayName: "正在查询报表B", state: "done" },
  { id: "3", displayName: "正在按流程汇总", state: "done" },
  { id: "4", displayName: "正在生成图表", state: "done" },
]

describe("ThinkingBlock", () => {
  it("进行中：显当前运行步 displayName，默认收起（步骤明细未渲染），点击展开", () => {
    const steps: ToolStatusItem[] = [
      { id: "1", displayName: "正在查询报表A", state: "done" },
      { id: "2", displayName: "正在生成统计数据", state: "running" },
    ]
    render(<ThinkingBlock steps={steps} phase="active" />)
    const head = screen.getByRole("button")
    expect(head.textContent).toContain("正在生成统计数据") // 当前运行步
    expect(head).toHaveProperty("ariaExpanded", "false")
    // 收起：明细 li 不在 DOM
    expect(screen.queryByText("正在查询报表A")).toBeNull()
    // 展开
    fireEvent.click(head)
    expect(head).toHaveProperty("ariaExpanded", "true")
    expect(screen.getByText("正在查询报表A")).toBeTruthy()
    // 当前运行步在头部与展开体各出现一次
    expect(screen.getAllByText("正在生成统计数据").length).toBeGreaterThanOrEqual(2)
  })

  it("进行中无运行步 → 回落「思考中…」", () => {
    render(<ThinkingBlock steps={[{ id: "1", displayName: "done step", state: "done" }]} phase="active" />)
    expect(screen.getByRole("button").textContent).toContain("思考中…")
  })

  it("完成·全成功：一行「已完成 · 4 步」，展开回看 4 步", () => {
    render(<ThinkingBlock steps={steps4} phase="done" />)
    expect(screen.getByRole("button").textContent).toContain("已完成 · 4 步")
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText("正在生成图表")).toBeTruthy()
  })

  it("完成·有失败：琥珀「部分步骤失败 · N 步」", () => {
    const steps: ToolStatusItem[] = [
      { id: "1", displayName: "步骤一", state: "done" },
      { id: "2", displayName: "步骤二", state: "failed" },
    ]
    render(<ThinkingBlock steps={steps} phase="done" />)
    expect(screen.getByRole("button").textContent).toContain("部分步骤失败 · 2 步")
    expect(screen.getByRole("button").className).toContain("amber")
  })

  it("无工具轮次（done + 0 步）→ 不渲染（返回 null，纯文本直答不留空块）", () => {
    const { container } = render(<ThinkingBlock steps={[]} phase="done" />)
    expect(container.querySelector("button")).toBeNull()
    expect(container.textContent).toBe("")
  })

  it("defaultOpen 可预展开", () => {
    render(<ThinkingBlock steps={steps4} phase="done" defaultOpen />)
    expect(screen.getByText("正在查询报表A")).toBeTruthy()
  })
})
