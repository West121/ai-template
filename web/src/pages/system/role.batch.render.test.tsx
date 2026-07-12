// @vitest-environment jsdom
/**
 * 角色管理 · 序号列 + 多选批量（启停/删除）冒烟：
 *  - 页面渲染不白屏（DataTable + 新增角色 按钮）
 *  - 角色列表数据渲染（角色名可见）
 * 只验证渲染安全；批量交互链路由 smoke-test 覆盖。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import RolePage from "./role"

const ROLES = [
  { id: 1, code: "MANAGER", name: "部门经理", dataScope: "DEPT", enabled: true, userCount: 3 },
  { id: 2, code: "STAFF", name: "普通员工", dataScope: "SELF", enabled: false, userCount: 8 },
]

beforeAll(() => {
  useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  // Radix 内部在 jsdom 需要的 DOM 方法
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  vi.stubGlobal("fetch", async (url: string) => {
    const p = String(url)
    let data: unknown = []
    if (p.includes("/api/system/roles?")) data = { list: ROLES, total: ROLES.length, pageNum: 1, pageSize: 100 }
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const renderPage = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <RolePage />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("角色 · 序号列 + 多选批量 渲染", () => {
  it("渲染不白屏：角色名 + 新增角色 按钮均可见", async () => {
    renderPage()
    expect(await screen.findByText("部门经理")).toBeTruthy()
    expect(screen.getByText("普通员工")).toBeTruthy()
    expect(screen.getByRole("button", { name: /新增角色/ })).toBeTruthy()
  })
})
