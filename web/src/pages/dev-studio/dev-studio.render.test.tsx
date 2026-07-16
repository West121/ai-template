// @vitest-environment jsdom
/**
 * 开发者工作台 冒烟（批W1）：
 *  - offline 演示：四类资产树渲染 → 点资产载入只读预览 → 编辑态切换 → 保存草稿版本+1
 *  - DINGTALK 流程：编辑禁用 + 引导用设计器
 *  - online：保存 PUT 形状 {content, baseVersion}；发布确认 → publish:true；409 → 冲突提示
 *  - 版本侧滑：列表（人/AI 徽标）→ 查看 → 回滚确认 → 回滚生效
 *  - 菜单 perm 过滤（filterMenu）
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import { filterMenu, menuTree } from "@/config/menu"
import { resetDevStudioMock } from "./dev-studio-api"
import DevStudioPage from "./index"

// W1 冒烟聚焦树/编辑/版本：右栏 AI（chat-view 重依赖懒加载）在 assistant-pane.render.test 单测，这里桩掉防全量跑超时
vi.mock("./assistant-pane", () => ({ DevStudioAssistantPane: () => null }))

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
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetDevStudioMock()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const renderPage = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <DevStudioPage />
      </TooltipProvider>
    </MemoryRouter>,
  )

const offline = () => useAuthStore.setState({ offline: true, permissions: null, token: null, user: null })

describe("开发者工作台（W1）", () => {
  it("offline → 四类资产树渲染 + 点资产载入只读预览 + demo banner", async () => {
    offline()
    renderPage()
    expect(await screen.findByText(/自动化编排（2）/)).toBeTruthy()
    expect(screen.getByText(/流程定义（2）/)).toBeTruthy()
    expect(screen.getByText(/在线表单（1）/)).toBeTruthy()
    expect(screen.getByText(/打印模板（1）/)).toBeTruthy()
    expect(screen.getAllByText(/演示资产/).length).toBeGreaterThan(0)

    const user = userEvent.setup()
    await user.click(screen.getByText("请假审批"))
    // 只读预览：内容出现在编辑器 + 顶条徽标；编辑按钮可用（GRAPH）
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("leave_approval"))
    expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "编辑" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("DINGTALK 流程 → 编辑禁用 + 引导用设计器打开", async () => {
    offline()
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByText("公文发文"))
    await waitFor(() => expect((screen.getByRole("button", { name: "编辑" }) as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByText(/不支持 raw JSON 直编/)).toBeTruthy()
    expect(screen.getByRole("button", { name: /用设计器打开/ })).toBeTruthy()
  })

  it("编辑态切换 + 保存草稿（演示）→ 版本 +1", async () => {
    offline()
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByText("同步用户"))
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy())
    await user.click(screen.getByRole("button", { name: "编辑" }))
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "发布" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "保存草稿" }))
    await waitFor(() => expect(screen.getAllByText("v5").length).toBeGreaterThan(0)) // 4 → 5
  })

  it("online → 保存 PUT {content, baseVersion}；发布确认 → publish:true", async () => {
    useAuthStore.setState({ offline: false, permissions: null, token: "t", user: null })
    const calls: { url: string; method: string; body: string }[] = []
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const p = String(url)
      calls.push({ url: p, method: String(init?.method ?? "GET"), body: String(init?.body ?? "") })
      if (init?.method === "PUT") return { status: 200, json: async () => ({ code: 0, data: { version: 9 } }) } as unknown as Response
      if (p.endsWith("/api/dev-studio/assets")) return { status: 200, json: async () => ({ code: 0, data: [{ type: "FORM", code: "leave", name: "请假单", status: "PUBLISHED", version: 3 }] }) } as unknown as Response
      if (p.includes("/FORM/leave")) return { status: 200, json: async () => ({ code: 0, data: { content: '{"widgets":[]}', version: 3, meta: { name: "请假单", status: "PUBLISHED" } } }) } as unknown as Response
      return { status: 200, json: async () => ({ code: 0, data: null }) } as unknown as Response
    })
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByText("请假单"))
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy())
    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.click(screen.getByRole("button", { name: "保存草稿" }))
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true))
    const put1 = calls.find((c) => c.method === "PUT")!
    expect(put1.url).toContain("/api/dev-studio/assets/FORM/leave")
    expect(put1.body).toContain('"baseVersion":3')
    expect(put1.body).toContain('"content"')
    expect(put1.body).not.toContain('"publish"')

    // 发布（保存草稿后仍在编辑态）：确认弹窗 → publish:true
    await user.click(screen.getByRole("button", { name: "发布" }))
    expect(await screen.findByText(/将立即生效/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "确认发布" }))
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT").length).toBe(2))
    expect(calls.filter((c) => c.method === "PUT")[1].body).toContain('"publish":true')
  })

  it("online 409 → 冲突提示「已被他人修改」+ 刷新按钮", async () => {
    useAuthStore.setState({ offline: false, permissions: null, token: "t", user: null })
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const p = String(url)
      if (init?.method === "PUT") return { status: 200, json: async () => ({ code: 409, message: "版本冲突" }) } as unknown as Response
      if (p.endsWith("/api/dev-studio/assets")) return { status: 200, json: async () => ({ code: 0, data: [{ type: "ORCH", code: "f1", name: "编排一", status: "DRAFT", version: 1 }] }) } as unknown as Response
      if (p.includes("/ORCH/f1")) return { status: 200, json: async () => ({ code: 0, data: { content: "{}", version: 1, meta: {} } }) } as unknown as Response
      return { status: 200, json: async () => ({ code: 0, data: null }) } as unknown as Response
    })
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByText("编排一"))
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy())
    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.click(screen.getByRole("button", { name: "保存草稿" }))
    expect(await screen.findByText(/已被他人修改/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy()
  })

  it("版本侧滑：列表（人/AI）→ 查看 → 回滚确认 → 回滚生效", async () => {
    offline()
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByText("同步用户"))
    await waitFor(() => expect(screen.getByRole("button", { name: "版本" })).toBeTruthy())
    await user.click(screen.getByRole("button", { name: "版本" }))
    expect(await screen.findByText(/历史版本 · 同步用户/)).toBeTruthy()
    const sheet = within(screen.getByRole("dialog"))
    expect(sheet.getByText("v4")).toBeTruthy()
    expect(sheet.getByText("AI")).toBeTruthy() // v3 是 AI 改的
    await user.click(sheet.getByText("v3"))
    expect(await screen.findByRole("button", { name: /回滚到 v3/ })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: /回滚到 v3/ }))
    expect(await screen.findByText(/回滚到 v3？/)).toBeTruthy() // 确认弹窗
    await user.click(screen.getByRole("button", { name: "确认回滚" }))
    await waitFor(() => expect(screen.queryByText(/历史版本 · 同步用户/)).toBeNull()) // 回滚后关闭
    await waitFor(() => expect(screen.getAllByText("v5").length).toBeGreaterThan(0)) // 新版本
  })

  it("无 dev:studio:view 权限 → 无权卡", async () => {
    useAuthStore.setState({ offline: false, permissions: ["some:other"], token: "t", user: null })
    renderPage()
    expect(await screen.findByText(/没有访问开发者工作台的权限/)).toBeTruthy()
  })
})

describe("菜单 perm 过滤（filterMenu）", () => {
  it("无 dev:studio:view → 菜单隐藏；permissions=null（离线）→ 放行；hidden 仍过滤", () => {
    const withPerm = filterMenu(menuTree, ["dev:studio:view"])
    expect(withPerm.some((i) => i.path === "/dev-studio")).toBe(true)
    const withoutPerm = filterMenu(menuTree, ["some:other"])
    expect(withoutPerm.some((i) => i.path === "/dev-studio")).toBe(false)
    const offlineAll = filterMenu(menuTree, null)
    expect(offlineAll.some((i) => i.path === "/dev-studio")).toBe(true)
    // hidden 项（个人中心）任何情况都不出现在导航
    expect(offlineAll.some((i) => i.path === "/profile")).toBe(false)
  })
})
