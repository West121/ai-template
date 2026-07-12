// @vitest-environment jsdom
/**
 * 文件管理 · 序号列 + 多选批量删除 冒烟：
 *  - 列表渲染不白屏（反白屏第 4 条）
 *  - 首列为序号列（表头 #）
 *  - canEdit（离线 permissions=null → allow-all）→ 开启多选；全选后底部胶囊出「已选 N 项」+ 删除
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import FilePage from "./file"

const ROWS = [
  {
    id: 1,
    originalName: "季度报表.xlsx",
    ext: "xlsx",
    size: 20480,
    storageType: "LOCAL",
    uploaderName: "张三",
    createdAt: "2026-07-01T09:00:00",
  },
  {
    id: 2,
    originalName: "合同.pdf",
    ext: "pdf",
    size: 51200,
    storageType: "MINIO",
    uploaderName: "李四",
    createdAt: "2026-07-02T10:00:00",
  },
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
    if (p.includes("/api/infra/files?")) data = { list: ROWS, total: ROWS.length, pageNum: 1, pageSize: 100 }
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const renderPage = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <FilePage />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("文件管理 序号列 + 多选批量删除", () => {
  it("渲染文件行 + 序号列表头 #（不白屏）", async () => {
    renderPage()
    expect(await screen.findByText("季度报表.xlsx")).toBeTruthy()
    expect(screen.getAllByText("#").length).toBeGreaterThanOrEqual(1)
  })

  it("多选就绪：全选 + 逐行选择框存在", async () => {
    renderPage()
    await screen.findByText("季度报表.xlsx")
    // 表头「全选」+ 每行「选择行」→ enableSelection 已挂载
    expect(screen.getByRole("checkbox", { name: "全选" })).toBeTruthy()
    expect(screen.getAllByRole("checkbox", { name: "选择行" }).length).toBe(ROWS.length)
  })

  it("全选 → 底部胶囊显「已选 N 项」+ 批量删除按钮", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("季度报表.xlsx")
    await user.click(screen.getByRole("checkbox", { name: "全选" }))
    // 选中后「已选」出现两处：胶囊「已选 N 项」+ 分页「已选 N 条」
    expect((await screen.findAllByText(/已选/)).length).toBeGreaterThanOrEqual(1)
    // 逐行删除按钮 + 胶囊批量删除按钮 → 数量 > 行数，证明胶囊内 batchSlot 已渲染
    expect(screen.getAllByRole("button", { name: /删除/ }).length).toBeGreaterThan(ROWS.length)
  })
})
