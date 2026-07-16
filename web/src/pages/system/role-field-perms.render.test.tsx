// @vitest-environment jsdom
/**
 * 角色抽屉「字段权限」Tab 冒烟（权限中心 P3）：
 *  - 选功能 → 字段矩阵渲染（formFields 按 group + fixedColumns「列表固定列」组）+ 已配回填
 *  - 两列联动：取消「可见」→「可编辑」自动关且禁用
 *  - 保存 → PUT /api/system/roles/{id}/field-perms?feature=（只下发受限字段）+ dirty 复位
 *  - catalog 空的功能 → 如实显示「该功能暂不支持字段权限」
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import { invalidateMineFieldPerms, resetFieldPermsMock } from "@/lib/field-perms"
import { RoleFieldPermsTab } from "./role-field-perms"

const FEATURES = [
  { featureCode: "ATTENDANCE_LEAVE", name: "请假管理" },
  { featureCode: "EMPTY_FEAT", name: "空功能" },
]
const CATALOG = {
  formFields: [
    { key: "leaveType", label: "请假类型", type: "select", group: "基础字段" },
    { key: "reason", label: "事由", type: "textarea", group: "基础字段" },
  ],
  fixedColumns: [{ field: "days", label: "时长（天）" }],
}
const ROLE_PERMS = [{ feature: "ATTENDANCE_LEAVE", field: "reason", visible: true, editable: false }]

let puts: { url: string; body: unknown }[] = []

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
})

beforeEach(() => {
  puts = []
  resetFieldPermsMock()
  invalidateMineFieldPerms()
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const p = String(url)
    let data: unknown = []
    if (init?.method === "PUT" && p.includes("/field-perms")) {
      puts.push({ url: p, body: JSON.parse(String(init.body)) })
      data = null
    } else if (p.includes("/api/ai/features")) data = FEATURES
    else if (p.includes("/api/system/field-perms/catalog")) data = p.includes("EMPTY_FEAT") ? { formFields: [], fixedColumns: [] } : CATALOG
    else if (p.includes("/api/system/roles/7/field-perms")) data = ROLE_PERMS
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const renderTab = (onDirtyChange?: (d: boolean) => void) =>
  render(
    <TooltipProvider>
      <RoleFieldPermsTab roleId={7} canEdit onDirtyChange={onDirtyChange} />
    </TooltipProvider>,
  )

const pickFeature = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(screen.getByRole("combobox"))
  await user.click(await screen.findByRole("option", { name }))
}

describe("角色字段权限 Tab", () => {
  it("选功能 → 矩阵渲染（分组 + 固定列组）+ 已配回填（事由只读）", async () => {
    renderTab()
    const user = userEvent.setup()
    await pickFeature(user, /请假管理/)

    expect(await screen.findByText("请假类型")).toBeTruthy()
    expect(screen.getByText("基础字段")).toBeTruthy()
    expect(screen.getByText("列表固定列")).toBeTruthy()
    expect(screen.getByText("时长（天）")).toBeTruthy()
    // 回填：事由 可见✓ / 可编辑✗
    expect(screen.getByRole("checkbox", { name: "事由 可见" }).getAttribute("data-state")).toBe("checked")
    expect(screen.getByRole("checkbox", { name: "事由 可编辑" }).getAttribute("data-state")).toBe("unchecked")
  })

  it("联动：取消「可见」→「可编辑」自动关且禁用；恢复可见 → 可编辑解禁", async () => {
    renderTab()
    const user = userEvent.setup()
    await pickFeature(user, /请假管理/)
    await screen.findByText("请假类型")

    const visible = screen.getByRole("checkbox", { name: "请假类型 可见" })
    const editable = () => screen.getByRole("checkbox", { name: "请假类型 可编辑" }) as HTMLButtonElement
    expect(editable().disabled).toBe(false)
    await user.click(visible)
    expect(editable().getAttribute("data-state")).toBe("unchecked")
    expect(editable().disabled).toBe(true)
    await user.click(visible)
    expect(editable().disabled).toBe(false)
  })

  it("保存 → PUT ?feature= 只下发受限字段；dirty true→false", async () => {
    const dirtySpy = vi.fn()
    renderTab(dirtySpy)
    const user = userEvent.setup()
    await pickFeature(user, /请假管理/)
    await screen.findByText("请假类型")

    await user.click(screen.getByRole("checkbox", { name: "请假类型 可见" })) // 隐藏请假类型
    await waitFor(() => expect(dirtySpy).toHaveBeenLastCalledWith(true))

    await user.click(screen.getByRole("button", { name: "保存字段权限" }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].url).toContain("/api/system/roles/7/field-perms?feature=ATTENDANCE_LEAVE")
    // 只下发受限字段：请假类型(隐藏) + 事由(只读)；days 全放行不下发；条目不带 feature（走查询参数）
    expect(puts[0].body).toEqual([
      { field: "leaveType", visible: false, editable: false },
      { field: "reason", visible: true, editable: false },
    ])
    await waitFor(() => expect(dirtySpy).toHaveBeenLastCalledWith(false))
  })

  it("全选工具条：全部隐藏 → 三字段可见全关", async () => {
    renderTab()
    const user = userEvent.setup()
    await pickFeature(user, /请假管理/)
    await screen.findByText("请假类型")

    await user.click(screen.getByRole("button", { name: "全部隐藏" }))
    for (const label of ["请假类型 可见", "事由 可见", "时长（天） 可见"]) {
      expect(screen.getByRole("checkbox", { name: label }).getAttribute("data-state")).toBe("unchecked")
    }
  })

  it("catalog 空的功能 → 如实显示不支持", async () => {
    renderTab()
    const user = userEvent.setup()
    await pickFeature(user, /空功能/)
    expect(await screen.findByText(/该功能暂不支持字段权限/)).toBeTruthy()
  })
})
