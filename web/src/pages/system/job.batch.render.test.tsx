// @vitest-environment jsdom
/**
 * 定时任务 · 序号列 冒烟：
 *  - 执行器信息 + 已注册 JobHandler 清单渲染不白屏（反白屏第 4 条）
 *  - JobHandler 表首列为序号（表头 #，行序号 1..N）
 * 说明：本页为 XXL-Job 接入信息页（任务增删改/启停在调度中心 iframe 内），
 *      无可管理的任务实体/ids/端点，故不接多选批量（见交付说明的对齐点）。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import JobPage from "./job"

const INFO = {
  enabled: true,
  consoleUrl: "",
  appname: "oa-executor",
  port: 9999,
  handlers: [
    { name: "demoJob", description: "示例任务：打印调度参数与执行日志", recommendedCron: "0 0/5 * * * ?" },
    { name: "approvalPendingReportJob", description: "待审批统计播报", recommendedCron: "0 0 9 * * ?" },
  ],
}

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
  vi.stubGlobal("fetch", async (url: string) => {
    const p = String(url)
    let data: unknown = []
    if (p.includes("/api/system/jobs")) data = INFO
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const renderPage = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <JobPage />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("定时任务 序号列", () => {
  it("JobHandler 清单渲染 + 序号列（不白屏）", async () => {
    renderPage()
    expect(await screen.findByText("demoJob")).toBeTruthy()
    // 序号列表头 #
    expect(screen.getAllByText("#").length).toBeGreaterThanOrEqual(1)
    // 行序号 1、2
    expect(screen.getByText("1")).toBeTruthy()
    expect(screen.getByText("2")).toBeTruthy()
  })
})
