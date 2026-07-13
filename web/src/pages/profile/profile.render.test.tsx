// @vitest-environment jsdom
/**
 * 个人中心 冒烟：
 *  - offline → 三 Tab（基本资料/安全设置/我的身份）渲染不炸 + 我的身份列出 assignments
 *  - 改密码校验（新<6 / 两次不一致）
 *  - online → 基本资料提交 PUT /api/auth/profile 形状 {nickname,phone,email}
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import ProfilePage from "./index"

const seedUser = { name: "张三", account: "zhangsan", email: "a@b.com", phone: "13800000000", dept: "技术部", post: "工程师", roles: ["员工"] }
const seedAssignments = [
  { id: 1, deptId: 2, deptName: "技术部", postName: "工程师", roleNames: ["员工"], primary: true },
  { id: 2, deptId: 3, deptName: "市场部", postName: "专员", roleNames: ["市场"], primary: false },
]

beforeAll(() => {
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
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const renderPage = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ProfilePage />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("个人中心", () => {
  it("offline → 三 Tab 渲染 + 我的身份列出 assignments + 安全设置显示改密表单", async () => {
    useAuthStore.setState({ offline: true, token: null, permissions: null, user: { ...seedUser }, assignments: seedAssignments, activeAssignmentId: "1" })
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole("tab", { name: /基本资料/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /安全设置/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /我的身份/ })).toBeTruthy()
    // 基本资料：昵称回填当前名
    expect((screen.getByLabelText("昵称") as HTMLInputElement).value).toBe("张三")

    // 我的身份：列出任职
    await user.click(screen.getByRole("tab", { name: /我的身份/ }))
    expect(await screen.findByText("技术部 · 工程师")).toBeTruthy()
    expect(screen.getByText("市场部 · 专员")).toBeTruthy()

    // 安全设置：改密表单
    await user.click(screen.getByRole("tab", { name: /安全设置/ }))
    expect(await screen.findByLabelText("原密码")).toBeTruthy()
    expect(screen.getByLabelText("确认新密码")).toBeTruthy()
  })

  it("改密码校验：新<6 提示、两次不一致提示", async () => {
    useAuthStore.setState({ offline: true, token: null, permissions: null, user: { ...seedUser }, assignments: [], activeAssignmentId: "" })
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole("tab", { name: /安全设置/ }))
    const newPwd = await screen.findByLabelText("新密码")
    await user.type(newPwd, "123")
    expect(await screen.findByText("新密码至少 6 位")).toBeTruthy()
    await user.type(screen.getByLabelText("确认新密码"), "654321")
    expect(await screen.findByText("两次输入的新密码不一致")).toBeTruthy()
  })

  it("online → 基本资料提交 PUT /api/auth/profile 形状 {nickname,phone,email}", async () => {
    useAuthStore.setState({ offline: false, token: "t", permissions: null, user: { ...seedUser }, assignments: seedAssignments, activeAssignmentId: "1" })
    const calls: { url: string; method: string; body: string }[] = []
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const p = String(url)
      calls.push({ url: p, method: String(init?.method ?? "GET"), body: String(init?.body ?? "") })
      if (p.endsWith("/api/auth/me")) return { status: 200, json: async () => ({ code: 0, data: { user: { name: "张三", username: "zhangsan", email: "a@b.com", phone: "13800000000", dept: "技术部", post: "工程师" } } }) } as unknown as Response
      if (p.endsWith("/api/auth/profile")) return { status: 200, json: async () => ({ code: 0, data: { name: "张三三", email: "a@b.com", phone: "13900000000" } }) } as unknown as Response
      return { status: 200, json: async () => ({ code: 0, data: null }) } as unknown as Response
    })
    const user = userEvent.setup()
    renderPage()

    const nick = (await screen.findByLabelText("昵称")) as HTMLInputElement
    await waitFor(() => expect(nick.value).toBe("张三"))
    await user.clear(nick)
    await user.type(nick, "张三三")
    const phone = screen.getByLabelText("手机") as HTMLInputElement
    await user.clear(phone)
    await user.type(phone, "13900000000")
    await user.click(screen.getByRole("button", { name: /保存资料/ }))

    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/api/auth/profile"))).toBe(true))
    const put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/api/auth/profile"))!
    expect(put.body).toContain('"nickname":"张三三"')
    expect(put.body).toContain('"phone":"13900000000"')
    expect(put.body).toContain('"email":"a@b.com"')
  })
})
