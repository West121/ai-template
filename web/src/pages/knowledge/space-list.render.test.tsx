// @vitest-environment jsdom
/** 空间列表页 反白屏冒烟：offline 演示数据 → 卡片网格 + 新建入口，renders without throwing。 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
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
    expect(await screen.findByText("产品研发知识库")).toBeTruthy()
    expect(screen.getByText("人力资源制度库")).toBeTruthy()
    expect(screen.getByText("董事会决策库")).toBeTruthy()
    // 可见性徽标
    expect(screen.getByText("公开")).toBeTruthy()
    expect(screen.getByText("私有")).toBeTruthy()
    // 新建入口 + 演示提示
    expect(screen.getByRole("button", { name: /新建空间/ })).toBeTruthy()
    expect(screen.getAllByText(/演示数据/).length).toBeGreaterThan(0)
  })
})
