// @vitest-environment jsdom
/**
 * 公文办文单套 WorkflowDetailShell 的反白屏 + 与审批统一 + 流程图增强验证（阶段 D）。
 * 用真实发文快照（GRAPH 流程，timeline 带 nodeId=start/review/issue）驱动整页：
 *  - 反白屏：标题/状态/badges(文种·密级·红头·文号)/环节条(用印)/办文动作(用印按钮)/信息分组网格/正文/预览
 *  - 与审批一致：办理记录/流程图/正文 三 Tab（基座内建）
 *  - 流程图增强：切流程图 Tab → FlowViewer(GRAPH) 逐节点办理信息(系统管理员) + 回放 + 预测运行
 */
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { useAuthStore } from "@/stores/auth-store"
import SendDetailPage from "../send-detail"
import { GW } from "./detail.fixture"

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO)
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  // 非离线 + 允许全部权限（permissions=null）→ 办文动作条渲染按钮
  useAuthStore.setState({ offline: false, token: "t", permissions: null })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})
vi.spyOn(console, "warn").mockImplementation(() => {})

// fetch 路由桩：公文详情 / gw_send 定义 / 预测 / 红头渲染 → 真实快照；其余空包
vi.stubGlobal("fetch", async (url: string) => {
  const p = String(url)
  let data: unknown = []
  if (p.includes("/api/office/doc/") && p.endsWith("/render")) data = GW.render
  else if (p.includes("/api/office/doc/") && p.includes("/predict")) data = GW.pred
  else if (p.match(/\/api\/office\/doc\/\d+$/)) data = GW.raw
  else if (p.includes("/api/wf/process-defs/gw_send/latest")) data = GW.def
  return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
})

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/document/send/${GW.id}`]}>
      <Routes>
        <Route path="/document/send/:id" element={<SendDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )

describe("公文办文单套基座（阶段 D）", () => {
  it("反白屏 + 与审批统一：标题/状态/badges/环节条/办文动作/信息分组/Tabs 全渲染", async () => {
    renderPage()
    expect(await screen.findByText(/冒烟测试发文B/)).toBeTruthy()
    // 头卡 badges：文种(通知) + 文号
    expect(screen.getAllByText(/通知/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/涵发/).length).toBeGreaterThan(0)
    // ② 环节条：当前环节 用印
    expect(screen.getAllByText("用印").length).toBeGreaterThan(0)
    // 办文动作：用印按钮（OpinionActionBar 进环节条同框）
    expect(screen.getByRole("button", { name: /用印/ })).toBeTruthy()
    // ③ 信息分组网格
    expect(screen.getByText("拟稿信息")).toBeTruthy()
    expect(screen.getByText("文号信息")).toBeTruthy()
    // ④ Tabs：办理记录 + 流程图（内建）+ 正文
    expect(screen.getByRole("tab", { name: /办理记录/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /流程图/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /正文/ })).toBeTruthy()
    // 办理记录：办理人 系统管理员（timeline actorName）
    expect(screen.getAllByText(/系统管理员/).length).toBeGreaterThan(0)
  })

  it("流程图增强在公文里显示：FlowViewer(GRAPH) 逐节点办理信息 + 回放 + 预测运行", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/冒烟测试发文B/)
    await user.click(screen.getByRole("tab", { name: /流程图/ }))
    // 图内节点办理信息（逐节点回填，靠 opinion.nodeId）→ 系统管理员
    await waitFor(() => expect(screen.getAllByText(/系统管理员/).length).toBeGreaterThan(0))
    // 回放 + 预测运行入口（公文现在白得全套流程图增强）
    expect(screen.getByRole("button", { name: "回放" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /预测运行/ })).toBeTruthy()
  })
})
