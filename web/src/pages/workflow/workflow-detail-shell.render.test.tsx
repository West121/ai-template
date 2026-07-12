// @vitest-environment jsdom
/**
 * WorkflowDetailShell 渲染冒烟（阶段 B）：空态/带各 slot/Tabs 切换/加载/错误/时间线当前脉冲，均不崩。
 * flow 用 inline 空源 → WorkflowFlowTrack 出"暂无流程图"占位（不触 react-flow），Shell 骨架独立可测。
 */
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { ShellField, ShellTimeline, WorkflowDetailShell, type ShellFlow, type WorkflowDetailShellProps } from "./workflow-detail-shell"
import type { WfTimelineItem } from "@/types/workflow"

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO)
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})
vi.spyOn(console, "warn").mockImplementation(() => {})

const TL_META = { APPROVE: { label: "同意", dot: "bg-emerald-500" }, SUBMIT: { label: "发起", dot: "bg-blue-500" } }
const emptyFlow: ShellFlow = { source: { load: "inline" }, timeline: [], timelineMeta: TL_META }

const renderShell = (over: Partial<WorkflowDetailShellProps>) =>
  render(
    <MemoryRouter>
      <WorkflowDetailShell title="测试详情" onBack={() => {}} flow={emptyFlow} {...over} />
    </MemoryRouter>,
  )

describe("WorkflowDetailShell 骨架", () => {
  it("最小：标题 + 办理记录/流程图 两内建 Tab", () => {
    renderShell({})
    expect(screen.getByText("测试详情")).toBeTruthy()
    expect(screen.getByRole("tab", { name: /办理记录/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /流程图/ })).toBeTruthy()
  })

  it("带各 slot：状态/badges/actions/meta/环节条+动作/信息区/extraTab/optionalTab/底部 全渲染", () => {
    renderShell({
      status: { label: "审批中", className: "text-amber-600" },
      badges: <span>红头公文</span>,
      actions: <button>打印</button>,
      meta: [{ label: "流程", value: "请假审批" }, { label: "当前节点", value: "经理审批", tone: "strong" }],
      currentNode: "经理审批",
      currentAssignee: "王经理",
      stageActions: <button>同意</button>,
      infoTitle: "表单信息",
      info: <div>表单快照</div>,
      extraTabs: [{ key: "content", label: "正文", content: <div>正文内容</div> }],
      optionalTabs: [{ key: "comments", label: "评论", count: 3, content: <div>评论区</div> }],
      bottom: <div>底部红头预览</div>,
    })
    expect(screen.getByText("审批中")).toBeTruthy()
    expect(screen.getByText("红头公文")).toBeTruthy()
    expect(screen.getByText("打印")).toBeTruthy()
    expect(screen.getByText(/请假审批/)).toBeTruthy()
    // 环节条（currentNode/assignee 在环节条 + 时间线脉冲行都出现 → getAllByText）
    expect(screen.getAllByText("经理审批").length).toBeGreaterThan(0)
    expect(screen.getAllByText("王经理").length).toBeGreaterThan(0)
    expect(screen.getByText("同意")).toBeTruthy() // stageActions
    expect(screen.getByText("表单快照")).toBeTruthy()
    expect(screen.getByText("底部红头预览")).toBeTruthy()
    // extra/optional tabs 存在
    expect(screen.getByRole("tab", { name: /正文/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /评论/ })).toBeTruthy()
  })

  it("Tabs 切换：办理记录 → 流程图（空源占位）→ 正文，不崩", async () => {
    const user = userEvent.setup()
    renderShell({ extraTabs: [{ key: "content", label: "正文", content: <div>正文内容XYZ</div> }] })
    await user.click(screen.getByRole("tab", { name: /流程图/ }))
    expect(screen.getByText("暂无流程图")).toBeTruthy()
    await user.click(screen.getByRole("tab", { name: /正文/ }))
    expect(screen.getByText("正文内容XYZ")).toBeTruthy()
  })

  it("流程预测键（flow.predict.enabled）→ 头卡出现，点击切到流程图 Tab", async () => {
    const user = userEvent.setup()
    renderShell({ flow: { ...emptyFlow, predict: { enabled: true, run: async () => ({ path: [] }) } } })
    await user.click(screen.getByRole("button", { name: /流程预测/ }))
    expect(screen.getByText("暂无流程图")).toBeTruthy() // 已切到流程图 Tab
  })

  it("终态无环节无动作 → 不渲染环节条", () => {
    const { container } = renderShell({})
    expect(container.querySelector(".border-primary\\/20")).toBeNull()
  })

  it("loading → 骨架；error=network → 离线卡；error=notfound → 不存在卡", () => {
    const { unmount } = renderShell({ loading: true })
    expect(screen.queryByText("测试详情")).toBeNull() // 骨架态无内容
    unmount()
    renderShell({ error: "network" })
    expect(screen.getByText("后端服务未启动")).toBeTruthy()
    cleanup()
    renderShell({ error: "notfound" })
    expect(screen.getByText("记录不存在或已删除")).toBeTruthy()
  })
})

describe("ShellTimeline（内建通用办理记录）", () => {
  const items: WfTimelineItem[] = [
    { action: "SUBMIT", nodeName: "起草", actorName: "张三", createdAt: "2026-07-12T09:00:00" },
    { action: "APPROVE", nodeName: "部门审批", actorName: "李经理", createdAt: "2026-07-12T10:00:00", comment: "同意办理" },
  ]
  it("参数化 meta 渲染 + 当前环节脉冲行", () => {
    render(<ShellTimeline items={items} meta={TL_META} current={{ node: "总经理审批", assignee: "王总" }} />)
    expect(screen.getByText("发起")).toBeTruthy() // SUBMIT→meta 发起
    expect(screen.getByText("起草")).toBeTruthy() // nodeName 徽标
    expect(screen.getByText("同意办理")).toBeTruthy() // APPROVE comment
    expect(screen.getByText("进行中")).toBeTruthy() // 当前脉冲
    expect(screen.getByText("总经理审批")).toBeTruthy()
  })
  it("空 items 且无 current → 暂无流转记录", () => {
    render(<ShellTimeline items={[]} meta={TL_META} />)
    expect(screen.getByText("暂无流转记录")).toBeTruthy()
  })
})

describe("ShellField", () => {
  it("label + value；空值 →", () => {
    render(<ShellField label="拟稿人" value="李明" />)
    expect(screen.getByText("拟稿人")).toBeTruthy()
    expect(screen.getByText("李明")).toBeTruthy()
    cleanup()
    render(<ShellField label="份号" value="" />)
    expect(screen.getByText("—")).toBeTruthy()
  })
})
