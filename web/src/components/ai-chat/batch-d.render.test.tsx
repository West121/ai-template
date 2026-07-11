// @vitest-environment jsdom
/**
 * 批D 新视图挂载烟测（防白屏规约第 4 层：新路由/交互"渲染不抛错"）：
 *  1) MemoryListView：列表/空态/加载态渲染不抛错
 *  2) BriefingCard：可点行（合法 featureCode）+ 非可点行（未知 code）+ items 非数组（垃圾）渲染不抛错
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { MemoryListView } from "./memory-list"
import { BriefingCard } from "./briefing-card"
import type { AiBriefing, AiMemory } from "./types"

afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const MEMORIES: AiMemory[] = [
  { id: "m1", memoryType: "EXPLICIT", memoryKey: "常用部门", memoryValue: "研发中心", updatedAt: "2026-07-12T09:00:00" },
  { id: "m2", memoryType: "INFERRED", memoryKey: "汇报偏好", memoryValue: "先图后表" },
  { id: "m3", memoryType: "SYSTEM_PREF", memoryKey: "默认档案", memoryValue: "STANDARD" },
]

describe("MemoryListView 挂载", () => {
  it("列表：渲染键值 + 类型徽标，不抛错", () => {
    render(<MemoryListView memories={MEMORIES} loading={false} onDelete={() => {}} />)
    expect(screen.getByText("常用部门")).toBeTruthy()
    expect(screen.getByText("显式")).toBeTruthy()
    expect(screen.getByText("推断")).toBeTruthy()
    expect(screen.getByText("偏好")).toBeTruthy()
  })

  it("空态 / 加载态渲染不抛错", () => {
    const { unmount } = render(<MemoryListView memories={[]} loading={false} onDelete={() => {}} />)
    expect(screen.getByText("还没有任何记忆")).toBeTruthy()
    unmount()
    render(<MemoryListView memories={[]} loading onDelete={() => {}} />)
    // 加载态不应报错（骨架屏）
  })
})

describe("BriefingCard 挂载", () => {
  const briefing: AiBriefing = {
    date: "2026-07-12",
    greeting: "早安",
    urgentCount: 2,
    meetingCount: 1,
    unreadCount: 3,
    items: [
      { title: "待签发通知", kind: "URGENT", featureCode: "WORKFLOW_TASKS", meta: "逾期" },
      { title: "未知去向条目", kind: "UNREAD", featureCode: "NOPE_UNKNOWN" }, // 无法解析 → 非可点
    ],
  }

  it("渲染汇总行 + 可点/非可点行 + 关闭按钮，不抛错", () => {
    render(
      <MemoryRouter>
        <BriefingCard briefing={briefing} onDismiss={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByText("今日简报")).toBeTruthy()
    expect(screen.getByText(/今日 2 件急事/)).toBeTruthy()
    expect(screen.getByText("待签发通知")).toBeTruthy()
    expect(screen.getByText("未知去向条目")).toBeTruthy()
    expect(screen.getByLabelText("今日不再显示")).toBeTruthy()
  })

  it("items 非数组（垃圾 payload）→ 空态兜底，不抛错", () => {
    render(
      <MemoryRouter>
        <BriefingCard briefing={{ ...briefing, items: "boom" as never }} onDismiss={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByText("今日简报")).toBeTruthy()
  })
})
