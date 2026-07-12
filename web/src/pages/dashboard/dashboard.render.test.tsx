// @vitest-environment jsdom
/**
 * 工作台双风格 冒烟：
 *  - 风格A「经典」渲染（renders without throwing）
 *  - 风格B「聚焦」渲染（AI 今日速览 / 今日聚焦 一句话摘要）
 *  - A/B 切换器切换后渲染对应风格
 * 均走 offline（degraded）演示数据，无需 fetch。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/stores/app-store"
import { useAuthStore } from "@/stores/auth-store"
import DashboardPage from "./index"

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const renderDash = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <DashboardPage />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("工作台双风格", () => {
  it("风格A 经典：渲染不白屏", () => {
    useAuthStore.setState({ offline: true, token: null, permissions: null, userId: 1 })
    useAppStore.setState({ dashboardStyle: "classic" })
    renderDash()
    expect(screen.getByText("待办审批")).toBeTruthy() // 经典独有区块
    expect(screen.getByText("近 7 日审批处理量")).toBeTruthy()
    expect(screen.queryByText("AI 今日速览")).toBeNull() // 聚焦独有，不应出现
  })

  it("风格B 聚焦：渲染 AI 今日速览 + 今日聚焦，不白屏", () => {
    useAuthStore.setState({ offline: true, token: null, permissions: null, userId: 1 })
    useAppStore.setState({ dashboardStyle: "focus" })
    renderDash()
    expect(screen.getByText("AI 今日速览")).toBeTruthy()
    expect(screen.getByText("今日聚焦")).toBeTruthy()
    expect(screen.getByText("待我处理")).toBeTruthy()
  })

  it("切换器：经典 → 聚焦 → 经典 各渲染对应风格", async () => {
    useAuthStore.setState({ offline: true, token: null, permissions: null, userId: 1 })
    useAppStore.setState({ dashboardStyle: "classic" })
    const user = userEvent.setup()
    renderDash()
    expect(screen.getByText("待办审批")).toBeTruthy()

    await user.click(screen.getByRole("tab", { name: /聚焦/ }))
    expect(await screen.findByText("AI 今日速览")).toBeTruthy()
    expect(screen.queryByText("待办审批")).toBeNull()

    await user.click(screen.getByRole("tab", { name: /经典/ }))
    expect(await screen.findByText("待办审批")).toBeTruthy()
  })
})
