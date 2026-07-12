// @vitest-environment jsdom
/**
 * 字典管理 · 序号列 + 多选批量删除（字典类型 / 字典项）冒烟：
 *  - 页面渲染不白屏（左类型列表 + 右字典项树表）
 *  - 字典类型渲染、默认选中第一个后拉取字典项渲染
 * 只验证渲染安全；批量删除链路由 smoke-test 覆盖。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import DictPage from "./dict"

const TYPES = [
  { id: 1, code: "leave_type", name: "请假类型", itemCount: 2, enabled: true },
  { id: 2, code: "education", name: "学历", itemCount: 1, enabled: true },
]
const ITEMS = [
  { id: 11, typeId: 1, label: "事假", value: "PERSONAL", sort: 10, enabled: true },
  { id: 12, typeId: 1, label: "病假", value: "SICK", sort: 20, enabled: true },
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
    if (p.includes("/api/infra/dict/types/") && p.includes("/items")) data = ITEMS
    else if (p.includes("/api/infra/dict/types?")) data = { list: TYPES, total: TYPES.length, pageNum: 1, pageSize: 100 }
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const renderPage = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <DictPage />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("字典 · 序号列 + 多选批量 渲染", () => {
  it("渲染不白屏：字典类型可见 + 新增 按钮", async () => {
    renderPage()
    expect(await screen.findByText("请假类型")).toBeTruthy()
    expect(screen.getByText("学历")).toBeTruthy()
    expect(screen.getByRole("button", { name: /新增根项/ })).toBeTruthy()
  })

  it("默认选中首个类型 → 字典项渲染", async () => {
    renderPage()
    expect(await screen.findByText("事假")).toBeTruthy()
    expect(screen.getByText("病假")).toBeTruthy()
  })
})
