// @vitest-environment jsdom
/** 空间列表页 反白屏冒烟：offline 演示数据 → 卡片网格 + 新建入口，renders without throwing。 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import SpaceList from "./space-list"

beforeAll(() => {
  useAuthStore.setState({ offline: true, permissions: null, userId: null, token: null })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("知识库 空间列表页", () => {
  it("演示空间卡片 + 新建入口 + 可见性徽标 + 演示提示条", async () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <SpaceList />
        </TooltipProvider>
      </MemoryRouter>,
    )
    // 空间卡片标题（用 heading 角色定位，避开统计「最近更新」里重复出现的空间名）
    expect(await screen.findByRole("heading", { name: "产品研发知识库" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "人力资源制度库" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "董事会决策库" })).toBeTruthy()
    // 可见性徽标
    expect(screen.getByText("公开")).toBeTruthy()
    expect(screen.getByText("私有")).toBeTruthy()
    // 新建入口 + 演示提示
    expect(screen.getByRole("button", { name: /新建空间/ })).toBeTruthy()
    expect(screen.getAllByText(/演示数据/).length).toBeGreaterThan(0)
  })

  it("「问知识库」按钮派发 ai:open 事件（唤起 AI 助手）", async () => {
    const spy = vi.fn()
    window.addEventListener("ai:open", spy)
    render(
      <MemoryRouter>
        <TooltipProvider>
          <SpaceList />
        </TooltipProvider>
      </MemoryRouter>,
    )
    await screen.findByRole("heading", { name: "产品研发知识库" })
    fireEvent.click(screen.getByRole("button", { name: /问知识库/ }))
    expect(spy).toHaveBeenCalled()
    window.removeEventListener("ai:open", spy)
  })
})
