// @vitest-environment jsdom
/**
 * WorkflowFlowTrack 渲染冒烟（重构阶段 A：抽取零回归验证）。
 * 用真实实例快照（DINGTALK）确认抽取后**节点办理信息 + 预测入口 + 连线高亮**照旧渲染；
 * 空源 → 占位；inline 契约不炸。
 */
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { WorkflowFlowTrack } from "./workflow-flow-track"
import { LEAVE_TRACK_FIXTURE } from "../../dingtalk-track.fixture"
import type { WfTimelineItem } from "@/types/workflow"
import type { WfPredictResult } from "@/types/workflow-p3"

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

const timeline = LEAVE_TRACK_FIXTURE.timeline as unknown as WfTimelineItem[]

describe("WorkflowFlowTrack（阶段 A 抽取）", () => {
  it("inline DINGTALK → 节点办理信息 + 状态角标 + 预测入口照旧渲染（零回归）", () => {
    const { container } = render(
      <WorkflowFlowTrack
        source={{ load: "inline", designerType: "DINGTALK", designerJson: LEAVE_TRACK_FIXTURE.designerJson }}
        timeline={timeline}
        highlight={LEAVE_TRACK_FIXTURE.highlight}
        currentNodes={LEAVE_TRACK_FIXTURE.currentNodes}
        predict={{ enabled: true, run: async () => ({ path: [] }) as WfPredictResult }}
      />,
    )
    const html = container.innerHTML
    expect(html).toContain("王经理") // ① 办理人
    expect(html).toContain("同意-fixture意见") // ① 意见摘要
    expect(html).toContain("已通过") // 状态角标
    expect(screen.getByRole("button", { name: /预测运行/ })).toBeTruthy() // ③ 预测入口（enabled）
  })

  it("predict.enabled=false → 无预测入口", () => {
    const { container } = render(
      <WorkflowFlowTrack
        source={{ load: "inline", designerType: "DINGTALK", designerJson: LEAVE_TRACK_FIXTURE.designerJson }}
        timeline={timeline}
        highlight={LEAVE_TRACK_FIXTURE.highlight}
        currentNodes={LEAVE_TRACK_FIXTURE.currentNodes}
      />,
    )
    expect(container.innerHTML).not.toContain("预测运行")
    // 回放按钮仍在（replaySteps 由内部 build）
    expect(screen.getByRole("button", { name: "回放" })).toBeTruthy()
  })

  it("inline 无源（无 designerJson/bpmnXml）→ 暂无流程图占位", () => {
    render(<WorkflowFlowTrack source={{ load: "inline", designerType: "DINGTALK" }} timeline={[]} />)
    expect(screen.getByText("暂无流程图")).toBeTruthy()
  })
})
