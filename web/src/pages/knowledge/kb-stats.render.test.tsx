// @vitest-environment jsdom
/** 知识库统计概览 冒烟（批5）：计数瓦片 + 最近更新，点击跳文档。offline 演示数据。 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useAuthStore } from "@/stores/auth-store"
import { KbStatsOverview } from "./kb-stats"

const navigate = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>()
  return { ...actual, useNavigate: () => navigate }
})

beforeAll(() => {
  useAuthStore.setState({ offline: true, permissions: null, userId: null, token: null })
})
afterEach(() => {
  cleanup()
  navigate.mockClear()
})
vi.spyOn(console, "error").mockImplementation(() => {})

describe("KbStatsOverview", () => {
  it("计数瓦片 + 最近更新，点击最近文档跳转", async () => {
    render(
      <MemoryRouter>
        <KbStatsOverview />
      </MemoryRouter>,
    )
    expect(await screen.findByText("知识空间")).toBeTruthy()
    expect(screen.getByText("文档")).toBeTruthy()
    expect(screen.getByText("可编辑空间")).toBeTruthy()
    expect(screen.getByText("标签")).toBeTruthy()
    expect(screen.getByText("最近更新")).toBeTruthy()
    // 最近文档可点跳转
    const doc = await screen.findByText("代码提交规约")
    fireEvent.click(doc)
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/knowledge\/\d+\?doc=\d+$/))
  })
})
