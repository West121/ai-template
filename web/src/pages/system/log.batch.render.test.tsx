// @vitest-environment jsdom
/**
 * 日志管理 · 序号列 + 多选批量清理 冒烟：
 *  - 操作日志表渲染不白屏（反白屏第 4 条）
 *  - 首列为序号列（表头 #）
 *  - 开启多选；全选后底部胶囊出「已选 N 项」+ 清理
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import LogPage from "./log"

const OPER = [
  { id: 1, username: "admin", module: "系统", action: "登录", method: "POST /api/auth/login", status: "SUCCESS", costMs: 12, ip: "127.0.0.1", createdAt: "2026-07-01T09:00:00" },
  { id: 2, username: "zhangsan", module: "审批", action: "提交", method: "POST /api/office/approvals", status: "FAIL", costMs: 1300, ip: "10.0.0.2", createdAt: "2026-07-01T10:00:00" },
]
const LOGIN = [
  { id: 11, username: "admin", ip: "127.0.0.1", location: "本地", userAgent: "Chrome", success: true, message: "登录成功", createdAt: "2026-07-01T09:00:00" },
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
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  vi.stubGlobal("fetch", async (url: string) => {
    const p = String(url)
    let data: unknown = []
    if (p.includes("/api/infra/logs/oper")) data = { list: OPER, total: OPER.length, pageNum: 1, pageSize: 100 }
    else if (p.includes("/api/infra/logs/login")) data = { list: LOGIN, total: LOGIN.length, pageNum: 1, pageSize: 100 }
    else if (p.includes("/api/infra/logs/runtime")) data = { file: "logs/oa-platform.log", lines: [] }
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const renderPage = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <LogPage />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("日志管理 序号列 + 多选批量清理", () => {
  it("操作日志渲染 + 序号列表头 #（不白屏）", async () => {
    renderPage()
    expect(await screen.findByText("zhangsan")).toBeTruthy()
    expect(screen.getAllByText("#").length).toBeGreaterThanOrEqual(1)
  })

  it("多选就绪：全选 + 逐行选择框存在", async () => {
    renderPage()
    await screen.findByText("zhangsan")
    // 操作日志表：表头「全选」+ 每行「选择行」→ enableSelection 已挂载
    expect(screen.getByRole("checkbox", { name: "全选" })).toBeTruthy()
    expect(screen.getAllByRole("checkbox", { name: "选择行" }).length).toBe(OPER.length)
  })

  it("全选 → 底部胶囊显「已选 N 项」+ 清理", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("zhangsan")
    await user.click(screen.getByRole("checkbox", { name: "全选" }))
    // 选中后「已选」出现两处：胶囊「已选 N 项」+ 分页「已选 N 条」
    expect((await screen.findAllByText(/已选/)).length).toBeGreaterThanOrEqual(1)
    // 「清理」按钮仅在胶囊内（日志行无操作按钮）→ 唯一，证明 batchSlot 已渲染
    expect(screen.getByRole("button", { name: /清理/ })).toBeTruthy()
  })
})
