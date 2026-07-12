// @vitest-environment jsdom
/**
 * 离职交接向导 冒烟（DP2）：
 *  - offline → 步1「生成交接单」→ 步2 演示清单（含未知 itemType=CUSTOM_ASSET 原值兜底，不炸）+ banner
 *    → 步3 执行成功（交接单 DONE）；全程 renders without throwing
 *  - online 400 部门负责人阻断 → 停在步1，高亮「请先指定继任者」
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useAuthStore } from "@/stores/auth-store"
import { ResignWizard } from "./resign-wizard"

const users = [
  { id: 1, name: "张三", empNo: "E1", primaryDeptName: "研发部" },
  { id: 2, name: "李四", empNo: "E2", primaryDeptName: "市场部" },
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

describe("ResignWizard（DP2）", () => {
  it("offline → 生成交接单 → 演示清单（未知 itemType 兜底）→ 执行成功，不白屏", async () => {
    useAuthStore.setState({ offline: true, token: null, permissions: null, userId: 1 })
    render(<ResignWizard open onOpenChange={() => {}} user={{ id: 1, name: "张三" }} users={users} onDone={() => {}} />)

    expect(screen.getByText("离职交接 · 张三")).toBeTruthy()

    // 步1 → 生成交接单（继任者选填，离线直接放行）
    fireEvent.click(screen.getByRole("button", { name: /生成交接单/ }))

    // 步2：演示清单 + banner + itemType 人话 & 未知原值兜底
    expect(await screen.findByText("待办转办")).toBeTruthy() // WF_TASK
    expect(screen.getByText("部门负责人变更")).toBeTruthy() // DEPT_LEADER
    expect(screen.getByText("CUSTOM_ASSET")).toBeTruthy() // 未知 itemType → 原值兜底，不炸
    expect(screen.getAllByText(/演示数据/).length).toBeGreaterThan(0)

    // 步3：执行 → 全部 PENDING→DONE，交接单完成
    fireEvent.click(screen.getByRole("button", { name: /执行交接/ }))
    expect(await screen.findByText(/交接单已完成/)).toBeTruthy()
  })

  it("online 400 部门负责人阻断 → 停在步1，高亮请先指定继任者", async () => {
    useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const p = String(url)
      if (p.includes("/resign") && init?.method === "POST") {
        return { status: 200, json: async () => ({ code: 400, message: "部门负责人未指定继任者，请先指定继任者" }) } as unknown as Response
      }
      return { status: 200, json: async () => ({ code: 0, data: null }) } as unknown as Response
    })
    render(<ResignWizard open onOpenChange={() => {}} user={{ id: 3, name: "王五" }} users={users} onDone={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: /生成交接单/ }))

    // 停在步1：错误横幅高亮，且步2「执行交接」按钮不出现
    expect(await screen.findByText(/请先指定继任者/)).toBeTruthy()
    await waitFor(() => expect(screen.getByRole("button", { name: /生成交接单/ })).toBeTruthy())
    expect(screen.queryByRole("button", { name: /执行交接/ })).toBeNull()
  })
})
