// @vitest-environment jsdom
/**
 * 多维数据权限授权 冒烟（DP1）：
 *  - offline → 演示两维（成本中心/项目）+ banner + 全部/指定单选 + CUSTOM 维回填 chip（renders without throwing）
 *  - online → 保存 PUT 形状（/roles/{id}/data-dimensions body [{dimension,scope,values}]）
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useAuthStore } from "@/stores/auth-store"
import { DataDimensionAuthz } from "./data-dimension-authz"

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

describe("DataDimensionAuthz（DP1）", () => {
  it("offline → 演示两维 + banner + 全部/指定 单选 + CUSTOM 回填 chip，不白屏", async () => {
    useAuthStore.setState({ offline: true, token: null, permissions: null, userId: 1 })
    render(<DataDimensionAuthz principalType="role" id={5} canEdit />)
    expect(await screen.findByText("成本中心")).toBeTruthy()
    expect(screen.getByText("项目")).toBeTruthy()
    expect(screen.getAllByText(/演示数据/).length).toBeGreaterThan(0)
    // 每维两个单选（全部/指定）
    expect(screen.getAllByText("全部").length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText("指定").length).toBeGreaterThanOrEqual(2)
    // 演示授权 costCenter=CUSTOM[1] → options 解析出 chip「研发中心」
    expect(await screen.findByText("研发中心")).toBeTruthy()
  })

  it("online → 保存走 PUT，body 为 [{dimension,scope,values}] 全量替换", async () => {
    useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
    const calls: { url: string; method: string; body: string }[] = []
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const p = String(url)
      calls.push({ url: p, method: String(init?.method ?? "GET"), body: String(init?.body ?? "") })
      let data: unknown = []
      if (p.endsWith("/api/system/data-dimensions")) data = [{ code: "costCenter", label: "成本中心" }, { code: "project", label: "项目" }]
      else if (p.includes("/data-dimensions/costCenter/options")) data = [{ id: 1, label: "研发中心" }, { id: 2, label: "市场部" }]
      else if (p.includes("/roles/5/data-dimensions")) data = init?.method === "PUT" ? null : [{ dimension: "costCenter", scope: "CUSTOM", values: [1] }]
      return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
    })
    render(<DataDimensionAuthz principalType="role" id={5} canEdit />)
    await screen.findByText("成本中心")
    await screen.findByText("研发中心") // CUSTOM 回填
    fireEvent.click(screen.getByRole("button", { name: /保存数据维度授权/ }))
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.includes("/api/system/roles/5/data-dimensions"))).toBe(true))
    const put = calls.find((c) => c.method === "PUT")!
    expect(put.body).toContain('"dimension":"costCenter"')
    expect(put.body).toContain('"scope":"CUSTOM"')
    expect(put.body).toContain('"values":[1]')
  })
})
