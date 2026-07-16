// @vitest-environment jsdom
/**
 * 数据维度管理页 冒烟（权限中心 P1）：
 *  - offline 演示：四种取值来源徽标（含 PROVIDER 代码内置）+ 绑定摘要 + 选项数
 *  - 编辑抽屉：code 锁死 + OPTION 内嵌选项编辑器（增/删，option-items 行PK 口径）
 *  - PROVIDER 源：选项维护置灰（内置 Provider 说明），label 仍可改
 *  - 新增：DICT 来源 → 字典类型下拉；保存后列表出现
 *  - 删除：被授权引用（演示 costCenter）→ 409 拦截行保留；未引用的删除成功
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import { resetDimensionMock } from "./dimension-api"
import DimensionPage from "./dimension"

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
})
beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  useAuthStore.setState({ offline: true, permissions: null, token: null, userId: 1 })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetDimensionMock()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const renderPage = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <DimensionPage />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("数据维度管理页", () => {
  it("offline → 四种取值来源徽标（含代码内置）+ 绑定摘要 + 选项数渲染", async () => {
    renderPage()
    expect(await screen.findByText("成本中心")).toBeTruthy()
    expect(screen.getByText("渠道")).toBeTruthy()
    expect(screen.getByText("业务线")).toBeTruthy()
    expect(screen.getByText("所属组织")).toBeTruthy()
    expect(screen.getByText("自定义选项")).toBeTruthy()
    expect(screen.getByText("数据字典")).toBeTruthy()
    expect(screen.getByText("组织部门")).toBeTruthy()
    expect(screen.getByText("代码内置")).toBeTruthy() // PROVIDER 徽标
    expect(screen.getAllByText(/oa_approval\./).length).toBeGreaterThan(0) // 绑定摘要 mono
    const chRow = screen.getByText("渠道").closest("tr")!
    await waitFor(() => expect(within(chRow).getByText("3")).toBeTruthy()) // 渠道（OPTION）选项数
    const ccRow = screen.getByText("成本中心").closest("tr")!
    expect(within(ccRow).getByText("—")).toBeTruthy() // PROVIDER 选项数显 —
  })

  it("编辑抽屉：code 锁死 + OPTION 选项编辑器增删（option-items 口径）", async () => {
    renderPage()
    const user = userEvent.setup()
    const row = (await screen.findByText("渠道")).closest("tr")!
    await user.click(within(row).getByRole("button", { name: /编辑/ }))
    expect(await screen.findByText(/编辑「渠道」/)).toBeTruthy()
    // code 锁死
    const codeInput = screen.getByLabelText("维度编码") as HTMLInputElement
    expect(codeInput.value).toBe("channel")
    expect(codeInput.disabled).toBe(true)
    // 选项编辑器：含禁用行精确回显 + 新增
    expect(await screen.findByDisplayValue("线上直营")).toBeTruthy()
    expect(screen.getByDisplayValue("历史渠道")).toBeTruthy() // 停用行也在（manage 口径）
    await user.type(screen.getByPlaceholderText("新选项名称"), "华南渠道")
    await user.click(screen.getByRole("button", { name: /新增/ }))
    expect(await screen.findByDisplayValue("华南渠道")).toBeTruthy()
    // 删除一个选项（按行 PK）
    await user.click(screen.getByRole("button", { name: "删除选项 渠道分销" }))
    await waitFor(() => expect(screen.queryByDisplayValue("渠道分销")).toBeNull())
  })

  it("PROVIDER 源：选项维护置灰（内置 Provider 说明），label 可改", async () => {
    renderPage()
    const user = userEvent.setup()
    const row = (await screen.findByText("成本中心")).closest("tr")!
    await user.click(within(row).getByRole("button", { name: /编辑/ }))
    expect(await screen.findByText(/编辑「成本中心」/)).toBeTruthy()
    // 选项/字典不可维护 → 置灰说明；无选项编辑器
    expect(screen.getByText(/由内置 Provider（代码注册 bean）提供取值——选项\/字典不可在此维护/)).toBeTruthy()
    expect(screen.queryByPlaceholderText("新选项名称")).toBeNull()
    // label/enabled 仍可改
    expect((screen.getByLabelText("维度名称") as HTMLInputElement).disabled).toBe(false)
  })

  it("新增维度：DICT 来源 → 字典类型下拉；保存后列表出现", async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: /新增维度/ }))
    expect(await screen.findByText("新增数据维度")).toBeTruthy()
    await user.type(screen.getByLabelText("维度名称"), "区域")
    await user.type(screen.getByLabelText("维度编码"), "region")
    const sheet = within(screen.getByRole("dialog"))
    await user.click(sheet.getByText("数据字典")) // 三选卡片（表格徽标里也有同词，限定抽屉内）
    expect(await screen.findByText("字典类型")).toBeTruthy()
    // 选字典类型（抽屉里首个 combobox=字典类型，其后为实体绑定两个）
    await user.click(screen.getAllByRole("combobox")[0])
    await user.click(await screen.findByRole("option", { name: /区域（region）/ }))
    await user.click(screen.getByRole("button", { name: "保存" }))
    expect(await screen.findByText("区域")).toBeTruthy() // 列表新行
  })

  it("删除：被授权引用（costCenter）→ 拦截行保留；未引用（业务线）→ 删除成功", async () => {
    renderPage()
    const user = userEvent.setup()
    // costCenter：演示 409
    const row1 = (await screen.findByText("成本中心")).closest("tr")!
    await user.click(within(row1).getByRole("button", { name: /删除/ }))
    await user.click(await screen.findByRole("button", { name: "确认删除" }))
    await waitFor(() => expect(screen.getByText("成本中心")).toBeTruthy()) // 行保留
    // 业务线：删除成功
    const row2 = screen.getByText("业务线").closest("tr")!
    await user.click(within(row2).getByRole("button", { name: /删除/ }))
    await user.click(await screen.findByRole("button", { name: "确认删除" }))
    await waitFor(() => expect(screen.queryByText("业务线")).toBeNull())
  })
})
