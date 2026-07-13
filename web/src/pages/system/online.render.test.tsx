// @vitest-environment jsdom
/**
 * 在线用户 冒烟：
 *  - offline → 演示列表渲染 + banner + 本机 badge + current 行禁踢（唯一 disabled 踢下线）
 *  - 踢下线二次确认（非 current 行 → 弹窗 → 确认关闭）
 *  - online → 踢下线 POST /api/system/online/{sessionId}/kick 形状
 *  - 空态：online 返回 [] 渲染不炸
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import OnlinePage from "./online"

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
        <OnlinePage />
      </TooltipProvider>
    </MemoryRouter>,
  )

const onlineRows = [
  { sessionId: "sess-current", userId: 1, username: "admin", name: "系统管理员", ip: "127.0.0.1", location: "内网 IP", client: "Chrome · Windows", loginTime: "2026-07-13 09:00:00", lastActive: "2026-07-13 10:00:00", current: true },
  { sessionId: "sess-2001", userId: 3, username: "zhangsan", name: "张三", ip: "112.10.238.77", location: "浙江省杭州市 · 电信", client: "Safari · macOS", loginTime: "2026-07-13 08:00:00", lastActive: "2026-07-13 09:59:00", current: false },
]

describe("在线用户", () => {
  it("offline → 演示列表 + banner + 本机 badge + current 行禁踢", async () => {
    useAuthStore.setState({ offline: true, token: null, permissions: null, user: { name: "系统管理员", account: "admin", dept: "", post: "", roles: [] } })
    renderPage()
    expect(await screen.findByText("张三")).toBeTruthy() // 演示会话
    expect(screen.getByText("王经理")).toBeTruthy()
    expect(screen.getAllByText(/离线演示数据/).length).toBeGreaterThan(0)
    expect(screen.getByText("本机")).toBeTruthy() // current 会话标记
    // 只有 current 行的「踢下线」被禁用
    const kickBtns = screen.getAllByRole("button", { name: /踢下线/ }) as HTMLButtonElement[]
    expect(kickBtns.filter((b) => b.disabled).length).toBe(1)
  })

  it("踢下线二次确认：非 current 行 → 弹窗 → 确认关闭", async () => {
    useAuthStore.setState({ offline: true, token: null, permissions: null, user: { name: "系统管理员", account: "admin", dept: "", post: "", roles: [] } })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("张三")
    const kickBtns = screen.getAllByRole("button", { name: /踢下线/ }) as HTMLButtonElement[]
    const enabled = kickBtns.find((b) => !b.disabled)!
    await user.click(enabled)
    expect(await screen.findByText(/强制「.+」下线/)).toBeTruthy() // 二确认弹窗
    await user.click(screen.getByRole("button", { name: /确认踢下线/ }))
    await waitFor(() => expect(screen.queryByText(/强制「.+」下线/)).toBeNull()) // 确认后关闭
  })

  it("online → 踢下线 POST /api/system/online/{sessionId}/kick", async () => {
    useAuthStore.setState({ offline: false, token: "t", permissions: null, user: { name: "系统管理员", account: "admin", dept: "", post: "", roles: [] } })
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const p = String(url)
      calls.push({ url: p, method: String(init?.method ?? "GET") })
      if (p.includes("/kick")) return { status: 200, json: async () => ({ code: 0, data: null }) } as unknown as Response
      return { status: 200, json: async () => ({ code: 0, data: onlineRows }) } as unknown as Response
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("张三")
    const kickBtns = screen.getAllByRole("button", { name: /踢下线/ }) as HTMLButtonElement[]
    await user.click(kickBtns.find((b) => !b.disabled)!)
    await user.click(await screen.findByRole("button", { name: /确认踢下线/ }))
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/api/system/online/sess-2001/kick"))).toBe(true))
  })

  it("空态：online 返回 [] 渲染不炸", async () => {
    useAuthStore.setState({ offline: false, token: "t", permissions: null, user: { name: "系统管理员", account: "admin", dept: "", post: "", roles: [] } })
    vi.stubGlobal("fetch", async (url: string) => ({ status: 200, json: async () => ({ code: 0, data: String(url).endsWith("/online") ? [] : null }) }) as unknown as Response)
    renderPage()
    expect(await screen.findByText("在线用户")).toBeTruthy()
    await waitFor(() => expect(screen.queryByText("张三")).toBeNull())
  })
})
