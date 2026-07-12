// @vitest-environment jsdom
/** 工作台 冒烟(防白屏规则 4):离线演示态渲染 4 张 KPI 统计卡片 + 各区块不抛错。 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useAuthStore } from "@/stores/auth-store"
import DashboardPage from "./index"

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>()
  return { ...actual, useNavigate: () => vi.fn() }
})

beforeAll(() => {
  useAuthStore.setState({ offline: true, permissions: null, token: null })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("DashboardPage", () => {
  it("离线演示态渲染 4 张 KPI 卡片 + 区块不抛错", async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText("待我审批")).toBeTruthy()
    expect(screen.getByText("今日会议")).toBeTruthy()
    expect(screen.getByText("本月出勤")).toBeTruthy()
    expect(screen.getByText("未读公告")).toBeTruthy()
    // 其它区块存在
    expect(screen.getByText("待办审批")).toBeTruthy()
    expect(screen.getByText("快捷发起")).toBeTruthy()
  })
})
