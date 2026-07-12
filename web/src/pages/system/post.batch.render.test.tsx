// @vitest-environment jsdom
/** 岗位管理 序号列+多选批量 反白屏冒烟：真实数据源（stub fetch）→ 表格渲染、批量删除入口不炸。 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import PostPage from "./post"

const POSTS = [
  { id: 1, code: "FE_DEV", name: "前端工程师", sort: 10, userCount: 3 },
  { id: 2, code: "BE_DEV", name: "后端工程师", sort: 20, userCount: 5 },
]

beforeAll(() => {
  useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  vi.stubGlobal("fetch", async (url: string) => {
    const p = String(url)
    const data = p.includes("/api/system/posts") ? { list: POSTS, total: POSTS.length, pageNum: 1, pageSize: 100 } : []
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("岗位管理 批量/序号 冒烟", () => {
  it("渲染岗位表格 + 序号表头 #，不白屏", async () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PostPage />
        </TooltipProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText("前端工程师")).toBeTruthy()
    expect(screen.getByText("后端工程师")).toBeTruthy()
    // 序号列表头
    expect(screen.getByText("#")).toBeTruthy()
    // 新增入口在
    expect(screen.getByRole("button", { name: /新增岗位/ })).toBeTruthy()
  })
})
