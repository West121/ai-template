// @vitest-environment jsdom
/**
 * 角色详情 Sheet 抽屉 冒烟（权限中心 P1）：
 *  - 编辑 → 四 Tab 渲染（基本信息/功能权限/数据权限/字段权限占位）
 *  - 功能权限 Tab：权限树加载（原「权限配置」搬入）+ 保存按钮
 *  - 未保存拦截：改名后切 Tab → AlertDialog → 丢弃并切换（回滚）
 *  - 新增：功能权限/字段权限 Tab 禁用（保存后可配）
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import RolePage from "./role"

const ROLES = [{ id: 1, code: "MANAGER", name: "部门经理", dataScope: "DEPT", enabled: true, userCount: 3 }]
const PERM_TREE = [
  { id: 10, code: "system", name: "系统管理", type: "MENU", children: [{ id: 11, code: "system:role:edit", name: "角色编辑", type: "BUTTON" }] },
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
    if (p.includes("/api/system/roles?")) data = { list: ROLES, total: 1, pageNum: 1, pageSize: 100 }
    else if (p.includes("/api/system/permissions/tree")) data = PERM_TREE
    else if (p.includes("/api/system/roles/1/permissions")) data = [10]
    else if (p.includes("/api/system/depts/tree")) data = []
    else if (p.includes("/data-dimensions")) data = []
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

const openEditSheet = async () => {
  const cell = await screen.findByText("部门经理")
  const row = cell.closest("tr")!
  fireEvent.click(within(row).getByRole("button", { name: /^编辑$/ }))
  await screen.findByText("角色「部门经理」")
}

describe("角色详情 Sheet（四 Tab）", () => {
  it("编辑 → Sheet 四 Tab 渲染 + 字段权限占位", async () => {
    renderPage()
    await openEditSheet()
    expect(screen.getByRole("tab", { name: "基本信息" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "功能权限" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "数据权限" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "字段权限" })).toBeTruthy()
    // 字段权限 P3 占位（forceMount 在 DOM）
    expect(screen.getByText("字段权限即将上线")).toBeTruthy()
    // 基本信息回填
    expect((screen.getByLabelText("角色名称") as HTMLInputElement).value).toBe("部门经理")
  })

  it("功能权限 Tab：权限树加载（回填勾选）+ 保存权限配置按钮", async () => {
    renderPage()
    await openEditSheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole("tab", { name: "功能权限" }))
    expect(await screen.findByText("系统管理")).toBeTruthy()
    expect(screen.getByText("角色编辑")).toBeTruthy()
    expect(screen.getByRole("button", { name: "保存权限配置" })).toBeTruthy()
    // 已勾权限回填（id=10 勾选）
    await waitFor(() => {
      const cb = document.querySelector("#perm-10") as HTMLElement
      expect(cb.getAttribute("data-state")).toBe("checked")
    })
  })

  it("未保存拦截：改名后切 Tab → 弹确认 → 丢弃并切换（回滚名称）", async () => {
    renderPage()
    await openEditSheet()
    const user = userEvent.setup()
    const nameInput = screen.getByLabelText("角色名称") as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, "改过的名字")
    await user.click(screen.getByRole("tab", { name: "数据权限" }))
    expect(await screen.findByText("有未保存修改")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "丢弃并切换" }))
    await waitFor(() => expect(nameInput.value).toBe("部门经理")) // 回滚
    expect(screen.getByRole("tab", { name: "数据权限" }).getAttribute("data-state")).toBe("active")
  })

  it("新增角色 → 功能权限/字段权限 Tab 禁用（保存后可配）", async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: /新增角色/ }))
    expect(await screen.findByRole("tab", { name: "基本信息" })).toBeTruthy() // 抽屉已开
    expect((screen.getByRole("tab", { name: "功能权限" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("tab", { name: "字段权限" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("tab", { name: "数据权限" }) as HTMLButtonElement).disabled).toBe(false) // 建时可设数据范围（原语义）
  })
})
