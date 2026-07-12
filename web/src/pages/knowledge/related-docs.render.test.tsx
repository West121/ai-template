// @vitest-environment jsdom
/** 相关文档侧栏 冒烟：演示相关列表渲染 + 点击跳转；docId=null 不渲染。 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useAuthStore } from "@/stores/auth-store"
import { RelatedDocs } from "./related-docs"

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

describe("相关文档侧栏", () => {
  it("渲染相关文档并可点击跳转", async () => {
    render(
      <MemoryRouter>
        <RelatedDocs docId={302} />
      </MemoryRouter>,
    )
    expect(await screen.findByText("相关文档")).toBeTruthy()
    // 同空间其它文档作为相关项（如「接口设计规范」）
    const item = await screen.findByText("接口设计规范")
    fireEvent.click(item)
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/knowledge\/\d+\?doc=\d+$/))
  })

  it("docId=null → 不渲染（不占位、不白屏）", () => {
    const { container } = render(
      <MemoryRouter>
        <RelatedDocs docId={null} />
      </MemoryRouter>,
    )
    expect(container.textContent).not.toContain("相关文档")
  })
})
