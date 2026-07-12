// @vitest-environment jsdom
/**
 * 审批实例详情页 · 套 WorkflowDetailShell 后的反白屏冒烟 + 零回归验证（阶段 C）。
 * 用真实实例快照（RUNNING/DINGTALK，含 P3 全动作）驱动整页：
 *  - 反白屏：页面挂载不崩，标题/状态/元信息/环节条/办理记录 Tab 全渲染
 *  - P3 操作：WfOpBar（同意/驳回…）+ WfP3Bar（打印/唤醒）+ 撤销入口挂载
 *  - 流程图增强：切到流程图 Tab → DINGTALK 跟踪图渲染节点办理信息 + 回放/预测入口
 */
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { useAuthStore } from "@/stores/auth-store"
import Page from "./instance-detail"
import { DETAIL } from "./instance-detail.fixture"

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO)
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  // 非离线 + 有身份（避免页面短路到离线卡；userId 与发起人不同 → 非发起人视角，撤销键不显）
  useAuthStore.setState({ offline: false, token: "t", userId: 999 })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})
vi.spyOn(console, "warn").mockImplementation(() => {})

// fetch 桩：实例详情返回真实快照；其余（已阅/模板/…）返回空包，不崩
vi.stubGlobal("fetch", async (url: string) => {
  const path = String(url)
  const body =
    path.includes("/api/wf/instances/") && !path.includes("/predict") && !path.includes("/read")
      ? { code: 0, data: DETAIL }
      : { code: 0, data: [] }
  return { status: 200, json: async () => body } as unknown as Response
})

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/workflow/instances/123"]}>
      <Routes>
        <Route path="/workflow/instances/:id" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  )

describe("审批详情套基座（阶段 C 零回归）", () => {
  it("反白屏：标题/状态/元信息/环节条/办理记录 全渲染 + P3 动作挂载", async () => {
    renderPage()
    // 详情异步加载后，标题出现（反白屏）
    expect(await screen.findByText(DETAIL.title)).toBeTruthy()
    // 状态徽标（"进行中"也可能出现在时间线脉冲行 → getAllByText）
    expect(screen.getAllByText(/审批中|进行中|RUNNING/).length).toBeGreaterThan(0)
    // 元信息：流程名（请假审批，可能也在表单里 → getAllByText）
    expect(screen.getAllByText(/请假/).length).toBeGreaterThan(0)
    // ② 环节条：当前环节 总经理审批
    expect(screen.getAllByText("总经理审批").length).toBeGreaterThan(0)
    // 四个 Tab（办理记录 + 流程图 内建 + 评论/通知 选配）
    expect(screen.getByRole("tab", { name: /办理记录/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /流程图/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /评论/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /通知/ })).toBeTruthy()
    // 办理记录时间线（默认 Tab）：历史办理人 王经理（timeline actorName·时间行，与原 Timeline 一致）
    expect(screen.getAllByText(/王经理/).length).toBeGreaterThan(0)
    // P3：打印键挂载（WfP3Bar 打印 / 单据打印 → getAllByRole）
    expect(screen.getAllByRole("button", { name: /打印/ }).length).toBeGreaterThan(0)
  })

  it("流程图增强：切到流程图 Tab → 节点办理信息 + 回放 + 预测入口", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(DETAIL.title)
    await user.click(screen.getByRole("tab", { name: /流程图/ }))
    // DINGTALK 跟踪图渲染：办理人（王经理）+ 回放/预测按钮
    await waitFor(() => expect(screen.getAllByText("王经理").length).toBeGreaterThan(0))
    expect(screen.getByRole("button", { name: "回放" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /预测运行/ })).toBeTruthy()
  })
})
