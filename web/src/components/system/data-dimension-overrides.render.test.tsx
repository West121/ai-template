// @vitest-environment jsdom
/**
 * 按功能覆盖 · 数据权限配置列表 冒烟（P2，附3 行式形态）：
 *  - 回显：GET 按 feature 分层——覆盖行入列表 + 「已脱离全局配置」提示；全局行不出现在列表
 *  - 添加行 + 维度切换换选择器：dept → OrgPicker 部门树；业务维 → 选项多选
 *  - 保存 → PUT 整体全量：全局行保全（无 feature 键）+ 覆盖行带 feature；校验拦截（缺功能/维度不发 PUT）
 *  - 目录空态不崩（防白屏）
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import { resetFieldPermsMock } from "@/lib/field-perms"
import { DataDimensionOverrides } from "./data-dimension-overrides"

const FEATURES = [
  { featureCode: "ATTENDANCE_LEAVE", name: "请假管理" },
  { featureCode: "WORKFLOW_TASKS", name: "我的审批" },
]
const DIMS = [
  { code: "costCenter", label: "成本中心" },
  { code: "project", label: "项目" },
]
const AUTHZ = [
  { dimension: "costCenter", scope: "CUSTOM", values: [1] }, // 全局层（不入覆盖列表、保存时保全）
  { feature: "ATTENDANCE_LEAVE", dimension: "costCenter", scope: "CUSTOM", values: [2] },
]

let authzData: unknown = AUTHZ
let puts: { url: string; body: unknown }[] = []
let gets: string[] = []

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
  gets = []
  authzData = AUTHZ
  resetFieldPermsMock()
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const p = String(url)
    let data: unknown = []
    if (!init?.method || init.method === "GET") gets.push(p)
    if (init?.method === "PUT" && p.includes("/data-dimensions")) {
      puts.push({ url: p, body: JSON.parse(String(init.body)) })
      data = null
    } else if (p.includes("/api/ai/features")) data = FEATURES
    else if (p.endsWith("/api/system/data-dimensions")) data = DIMS
    else if (p.includes("/data-dimensions/costCenter/options")) data = [{ id: 1, label: "研发中心" }, { id: 2, label: "市场部" }]
    else if (p.includes("/roles/7/data-dimensions")) data = authzData
    else if (p.includes("/api/system/depts/tree")) data = [{ id: 10, name: "总部", children: [] }]
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const renderOverrides = () =>
  render(
    <TooltipProvider>
      <DataDimensionOverrides principalType="role" id={7} canEdit />
    </TooltipProvider>,
  )

describe("按功能覆盖列表（P2）", () => {
  it("回显：GET ?all=1 → 覆盖行入列表 + 脱离全局提示 + 值 chip 解析；全局行不出现在列表", async () => {
    renderOverrides()
    expect(await screen.findByText(/「请假管理」已脱离全局配置/)).toBeTruthy()
    expect(gets.some((u) => u.includes("/roles/7/data-dimensions?all=1"))).toBe(true)
    // 覆盖行的值 chip（costCenter id=2 → 市场部）
    expect(await screen.findByText("市场部")).toBeTruthy()
    // 全局行（feature 空）不在覆盖列表：只有 1 行 → 只有 1 组功能下拉
    expect(screen.getAllByLabelText("选择功能")).toHaveLength(1)
  })

  it("添加行 + 维度切换换选择器：dept → 部门树 OrgPicker；业务维 → 选项多选", async () => {
    renderOverrides()
    const user = userEvent.setup()
    await screen.findByText(/已脱离全局配置/)
    await user.click(screen.getByRole("button", { name: /添加资源/ }))
    expect(screen.getAllByLabelText("选择功能")).toHaveLength(2)

    // 新行选功能=我的审批
    await user.click(screen.getAllByLabelText("选择功能")[1])
    await user.click(await screen.findByRole("option", { name: /我的审批/ }))
    // 维度=组织(部门)
    await user.click(screen.getAllByLabelText("选择维度")[1])
    await user.click(await screen.findByRole("option", { name: "组织(部门)" }))
    // 范围=自定义（dept 维 5 档中的 CUSTOM）→ 出部门选择器
    await user.click(screen.getAllByLabelText("选择范围")[1])
    await user.click(await screen.findByRole("option", { name: "自定义" }))
    expect(screen.getByText(/选择部门（多选，值为部门 id 精确集）/)).toBeTruthy()
    // 打开 → OrgPicker 部门树弹窗
    await user.click(screen.getByText(/选择部门（多选，值为部门 id 精确集）/))
    expect(await screen.findByText("选择该功能可见部门")).toBeTruthy()
    await user.keyboard("{Escape}")

    // 维度切到业务维 成本中心 → 选择器换为选项多选
    await user.click(screen.getAllByLabelText("选择维度")[1])
    await user.click(await screen.findByRole("option", { name: "成本中心" }))
    expect(screen.getByText("选择可见范围（多选）")).toBeTruthy()
  })

  it("保存 → 按层替换：每个 feature 一次 PUT ?feature=X，body 不带 feature；不触碰全局层；缺功能/维度先拦截", async () => {
    renderOverrides()
    const user = userEvent.setup()
    await screen.findByText(/已脱离全局配置/)

    // 未补全的新行 → 保存被拦截，不发 PUT（toast 在组件树外，不断言文案）
    await user.click(screen.getByRole("button", { name: /添加资源/ }))
    await user.click(screen.getByRole("button", { name: /保存按功能覆盖/ }))
    expect(puts).toHaveLength(0)

    // 补全：功能=我的审批 × 维度=项目 × 范围=全部数据（缺省）
    await user.click(screen.getAllByLabelText("选择功能")[1])
    await user.click(await screen.findByRole("option", { name: /我的审批/ }))
    await user.click(screen.getAllByLabelText("选择维度")[1])
    await user.click(await screen.findByRole("option", { name: "项目" }))
    await user.click(screen.getByRole("button", { name: /保存按功能覆盖/ }))

    await waitFor(() => expect(puts).toHaveLength(2)) // 两个功能层各一次 PUT；全局层不触碰
    const leave = puts.find((p) => p.url.includes("feature=ATTENDANCE_LEAVE"))!
    const tasks = puts.find((p) => p.url.includes("feature=WORKFLOW_TASKS"))!
    expect(leave.url).toContain("/api/system/roles/7/data-dimensions?feature=")
    // body 不带 feature（以 query 为准）
    expect(leave.body).toEqual([{ dimension: "costCenter", scope: "CUSTOM", values: [2] }])
    expect(tasks.body).toEqual([{ dimension: "project", scope: "ALL", values: [] }])
    expect(puts.some((p) => !p.url.includes("feature="))).toBe(false)
  })

  it("删光某功能的行 → 保存对该层 PUT []（清空回落全局）", async () => {
    renderOverrides()
    const user = userEvent.setup()
    await screen.findByText(/已脱离全局配置/)
    await user.click(screen.getByRole("button", { name: "删除覆盖行" }))
    expect(screen.queryByText(/已脱离全局配置/)).toBeNull()
    await user.click(screen.getByRole("button", { name: /保存按功能覆盖/ }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].url).toContain("?feature=ATTENDANCE_LEAVE")
    expect(puts[0].body).toEqual([])
  })

  it("dept 行范围下拉=完整 5 档；相对档不出值选择器，保存 PUT values=[]", async () => {
    renderOverrides()
    const user = userEvent.setup()
    await screen.findByText(/已脱离全局配置/)
    await user.click(screen.getByRole("button", { name: /添加资源/ }))
    await user.click(screen.getAllByLabelText("选择功能")[1])
    await user.click(await screen.findByRole("option", { name: /我的审批/ }))
    await user.click(screen.getAllByLabelText("选择维度")[1])
    await user.click(await screen.findByRole("option", { name: "组织(部门)" }))

    // 五档齐全
    await user.click(screen.getAllByLabelText("选择范围")[1])
    for (const label of ["全部数据", "本部门及以下", "本部门", "仅本人", "自定义"]) {
      expect(await screen.findByRole("option", { name: label })).toBeTruthy()
    }
    // 选相对档 → 无值选择器 + 动态语义提示
    await user.click(screen.getByRole("option", { name: "本部门及以下" }))
    expect(screen.queryByText(/选择部门（多选/)).toBeNull()
    expect(screen.getByText(/按办理人当时的任职部门动态计算/)).toBeTruthy()

    await user.click(screen.getByRole("button", { name: /保存按功能覆盖/ }))
    await waitFor(() => expect(puts.some((p) => p.url.includes("feature=WORKFLOW_TASKS"))).toBe(true))
    const put = puts.find((p) => p.url.includes("feature=WORKFLOW_TASKS"))!
    expect(put.body).toEqual([{ dimension: "dept", scope: "DEPT_AND_CHILD", values: [] }])
  })

  it("业务维行范围下拉仍两档（全部数据/指定）", async () => {
    renderOverrides()
    const user = userEvent.setup()
    await screen.findByText(/已脱离全局配置/)
    // 回显行是 costCenter（业务维）→ 打开其范围下拉
    await user.click(screen.getAllByLabelText("选择范围")[0])
    expect(await screen.findByRole("option", { name: "全部数据" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "指定" })).toBeTruthy()
    expect(screen.queryByRole("option", { name: "本部门及以下" })).toBeNull()
    expect(screen.queryByRole("option", { name: "仅本人" })).toBeNull()
    await user.keyboard("{Escape}")
  })

  it("目录/授权空态 → 空态引导渲染不崩（防白屏）", async () => {
    authzData = []
    renderOverrides()
    expect(await screen.findByText(/暂无按功能覆盖/)).toBeTruthy()
    expect(screen.getByRole("button", { name: /添加资源/ })).toBeTruthy()
  })
})
