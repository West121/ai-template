// @vitest-environment jsdom
/**
 * 角色编辑 CUSTOM 数据权限 · 自定义部门多选 冒烟：
 *  - dataScope=CUSTOM → 显「自定义可见部门」多选 + 回填部门 chips（名称由部门树解析）
 *  - 非 CUSTOM → 隐藏
 *  - 「选择部门」→ 打开 OrgPicker（DEPT）
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import RolePage from "./role"

const ROLES = [
  { id: 1, code: "CUSTOM_R", name: "自定义角色", dataScope: "CUSTOM", enabled: true, userCount: 2, customDeptIds: [10, 20] },
  { id: 2, code: "SELF_R", name: "本人角色", dataScope: "SELF", enabled: true, userCount: 1 },
]
const DEPTS = [
  { id: 10, name: "研发部", children: [{ id: 11, name: "前端组" }] },
  { id: 20, name: "市场部" },
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
    else if (p.includes("/api/system/depts/tree")) data = DEPTS
    else if (p.includes("/api/system/users")) data = { list: [], total: 0, pageNum: 1, pageSize: 100 }
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
const editRow = async (name: string) => {
  const cell = await screen.findByText(name)
  const row = cell.closest("tr")!
  fireEvent.click(within(row).getByRole("button", { name: /编辑/ }))
}

describe("角色 CUSTOM 自定义部门多选", () => {
  it("编辑 CUSTOM 角色 → 显自定义部门多选 + 回填 chips（名称解析）", async () => {
    renderPage()
    await editRow("自定义角色")
    expect(await screen.findByText("自定义可见部门")).toBeTruthy()
    // 回填：customDeptIds=[10,20] → 部门树解析出名称
    await waitFor(() => expect(screen.getByText("研发部")).toBeTruthy())
    expect(screen.getByText("市场部")).toBeTruthy()
    expect(screen.getByRole("button", { name: /选择部门/ })).toBeTruthy()
  })

  it("编辑非 CUSTOM 角色 → 不显自定义部门", async () => {
    renderPage()
    await editRow("本人角色")
    // 表单打开（数据权限范围可见）但无自定义部门区
    expect(await screen.findByText("数据权限范围")).toBeTruthy()
    expect(screen.queryByText("自定义可见部门")).toBeNull()
  })

  it("点「选择部门」→ 打开部门选择器（OrgPicker DEPT）", async () => {
    renderPage()
    await editRow("自定义角色")
    fireEvent.click(await screen.findByRole("button", { name: /选择部门/ }))
    expect(await screen.findByText("选择自定义可见部门")).toBeTruthy()
  })
})
