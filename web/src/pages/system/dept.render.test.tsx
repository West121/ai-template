// @vitest-environment jsdom
/**
 * 部门管理薄壳渲染冒烟（反白屏第 4 条）：
 *  - 薄壳页挂载共享 <DeptTree>，在线 + stub fetch → 渲染出部门名，不抛错。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import DeptPage from "./dept"

const DEPTS = [
  {
    id: 10,
    name: "研发中心",
    enabled: true,
    userCount: 8,
    sort: 10,
    children: [{ id: 11, name: "前端组", enabled: true, userCount: 3, sort: 10 }],
  },
  { id: 20, name: "市场部", enabled: true, userCount: 5, sort: 20 },
]
const USERS = [
  { id: 1, name: "张三", username: "zhangsan", empNo: "XC0001", enabled: true, roleNames: [] },
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
    let data: unknown = []
    if (p.includes("/api/system/depts/tree")) data = DEPTS
    else if (p.includes("/api/system/users")) data = { list: USERS, total: USERS.length, pageNum: 1, pageSize: 100 }
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("部门管理薄壳渲染冒烟", () => {
  it("整页挂载不抛错，渲染出部门名", async () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <DeptPage />
        </TooltipProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText("研发中心")).toBeTruthy()
    expect(screen.getByText("市场部")).toBeTruthy()
    expect(screen.getByText("全部部门")).toBeTruthy()
  })
})
