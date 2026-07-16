// @vitest-environment jsdom
/**
 * 渲染侧字段权限过滤冒烟（权限中心 P3，请假链路示范）：
 *  - mine 说 reason 不可见 → 请假列表「事由」整列隐藏（表头+单元格都不渲染），其余列不受影响
 *  - mine 空（全放行）→ 列全在
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import { invalidateMineFieldPerms } from "@/lib/field-perms"
import AttendanceLeavePage from "./leave"

const ROWS = [
  { id: 1, type: "ANNUAL", startDate: "2026-07-01", endDate: "2026-07-02", days: 2, reason: "看牙医休整", status: "PENDING" },
]

let mineFields: Record<string, { visible: boolean; editable: boolean }> = {}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal("fetch", async (url: string) => {
    const p = String(url)
    let data: unknown = []
    if (p.includes("/api/office/leaves/quotas")) data = [{ type: "ANNUAL", total: 10, used: 2 }]
    else if (p.includes("/api/office/leaves?")) data = { list: ROWS, total: 1, pageNum: 1, pageSize: 100 }
    else if (p.includes("/api/system/field-perms/mine")) data = { fields: mineFields }
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})

beforeEach(() => {
  useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
  invalidateMineFieldPerms()
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const renderPage = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <AttendanceLeavePage />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("请假列表 · mine 字段权限列过滤", () => {
  it("mine.reason.visible=false → 「事由」整列隐藏（表头与内容都不渲染）", async () => {
    mineFields = { reason: { visible: false, editable: false } }
    renderPage()
    // 行已渲染（单号列在）
    expect(await screen.findByText("QJ0001")).toBeTruthy()
    expect(screen.getByText("时长（天）")).toBeTruthy()
    // 事由列整列不见：表头 + 单元格内容
    expect(screen.queryByText("事由")).toBeNull()
    expect(screen.queryByText("看牙医休整")).toBeNull()
  })

  it("mine 空 → 全列可见（事由在）", async () => {
    mineFields = {}
    renderPage()
    expect(await screen.findByText("QJ0001")).toBeTruthy()
    expect(screen.getByText("事由")).toBeTruthy()
    expect(screen.getByText("看牙医休整")).toBeTruthy()
  })
})
