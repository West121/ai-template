// @vitest-environment jsdom
/**
 * DingtalkTrack 节点办理信息渲染断言（用户实测 bug：DINGTALK 定义下办理信息不显示）。
 * 用**真实实例快照**（server API 抓取的 leave_approval，timeline nodeId=start/mgr，designerJson 同一套 id）：
 *  1) buildNodeInfo 从真实 timeline 命中 mgr/start 节点
 *  2) DingtalkTrack 渲染出办理人/意见/状态角标（证明修复生效，非仅单测）
 */
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { buildNodeInfo, buildReplaySteps } from "./designer/flow/runtime-info"
import { DingtalkTrack } from "./wf-dingtalk-track"
import { LEAVE_TRACK_FIXTURE } from "./dingtalk-track.fixture"
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

const timeline = LEAVE_TRACK_FIXTURE.timeline as unknown as WfTimelineItem[]

describe("真实实例 buildNodeInfo（id 同一套证明）", () => {
  it("timeline nodeId=start/mgr 命中；mgr 已通过含办理人+意见；gm 进行中", () => {
    const info = buildNodeInfo(timeline, LEAVE_TRACK_FIXTURE.highlight, LEAVE_TRACK_FIXTURE.currentNodes)
    expect(info.mgr.status).toBe("completed")
    expect(info.mgr.assignees[0].name).toBe("王经理")
    expect(info.mgr.assignees[0].opinion).toBe("同意-fixture意见")
    expect(info.start.assignees[0].name).toBe("张三")
    expect(info.gm.status).toBe("active") // highlight.active=["gm"]
  })
})

describe("DingtalkTrack 真实数据渲染（修复验证）", () => {
  it("有 nodeInfo → 卡片输出办理人·意见·状态角标 DOM", () => {
    const nodeInfo = buildNodeInfo(timeline, LEAVE_TRACK_FIXTURE.highlight, LEAVE_TRACK_FIXTURE.currentNodes)
    const { container } = render(
      <DingtalkTrack designerJson={LEAVE_TRACK_FIXTURE.designerJson} highlight={LEAVE_TRACK_FIXTURE.highlight} nodeInfo={nodeInfo} />,
    )
    const html = container.innerHTML
    // 办理意见只来自 timeline（非设计态候选人）→ 出现即证明办理信息层渲染
    expect(html).toContain("同意-fixture意见")
    expect(html).toContain("王经理")
    expect(html).toContain("已通过")
    expect(html).toContain("进行中") // gm active
  })

  it("无 nodeInfo（旧行为）→ 不含 timeline 办理意见（对照，证明是本修复带来的）", () => {
    const { container } = render(
      <DingtalkTrack designerJson={LEAVE_TRACK_FIXTURE.designerJson} highlight={LEAVE_TRACK_FIXTURE.highlight} />,
    )
    expect(container.innerHTML).not.toContain("同意-fixture意见")
  })
})

describe("② 回放 / ③ 预测 已搬到钉钉视图（课程纠偏核心）", () => {
  const nodeInfo = buildNodeInfo(timeline, LEAVE_TRACK_FIXTURE.highlight, LEAVE_TRACK_FIXTURE.currentNodes)
  const replaySteps = buildReplaySteps(timeline) // ["start","mgr"]

  it("replaySteps(≥2) → 顶部出现「回放」按钮", () => {
    render(
      <DingtalkTrack designerJson={LEAVE_TRACK_FIXTURE.designerJson} highlight={LEAVE_TRACK_FIXTURE.highlight} nodeInfo={nodeInfo} replaySteps={replaySteps} />,
    )
    expect(screen.getByRole("button", { name: "回放" })).toBeTruthy()
  })

  it("predictable(onRequestPredict) → 「预测运行」按钮", () => {
    render(
      <DingtalkTrack designerJson={LEAVE_TRACK_FIXTURE.designerJson} highlight={LEAVE_TRACK_FIXTURE.highlight} nodeInfo={nodeInfo} onRequestPredict={() => {}} />,
    )
    expect(screen.getByRole("button", { name: /预测运行/ })).toBeTruthy()
  })

  it("完整链路预测（真实 /predict：mgr done + gm current + cc1 future）→ 「播放预测」+ 预计办理人 + 可驳回/或签标注", () => {
    const { container } = render(
      <DingtalkTrack
        designerJson={LEAVE_TRACK_FIXTURE.designerJson}
        highlight={LEAVE_TRACK_FIXTURE.highlight}
        nodeInfo={nodeInfo}
        predict={{
          nodes: [
            { nodeId: "mgr", status: "done", assignees: ["王经理"], canReject: true, rejectTo: { nodeId: "start", name: "张三" }, multiMode: "ANY" },
            { nodeId: "gm", status: "current", assignees: ["系统管理员"], canReject: true, rejectTo: { nodeId: "start", name: "张三" }, multiMode: "ANY" },
            { nodeId: "cc1", status: "future", assignees: [], multiMode: null },
          ],
        }}
      />,
    )
    expect(screen.getByRole("button", { name: "播放预测" })).toBeTruthy()
    // gm(current) 显预计办理人 + 或签 + 可驳回标注
    expect(container.innerHTML).toContain("预计 系统管理员")
    expect(container.innerHTML).toContain("或签")
    expect(container.innerHTML).toContain("可驳回")
  })

  it("已办结实例预测（全 done）→ 完整链路全绿、无预测蓝节点", () => {
    // 造全 done 链路（含 cc1，days=2 走 mgr→cc1）
    const { container } = render(
      <DingtalkTrack
        designerJson={LEAVE_TRACK_FIXTURE.designerJson}
        highlight={LEAVE_TRACK_FIXTURE.highlight}
        nodeInfo={nodeInfo}
        predict={{
          note: "流程已结束，展示完整链路",
          nodes: [
            { nodeId: "mgr", status: "done", assignees: ["王经理"], multiMode: "ANY", canReject: true, rejectTo: { nodeId: "start", name: "张三" } },
            { nodeId: "cc1", status: "done", assignees: [] },
          ],
        }}
      />,
    )
    // 全 done → 无"预计"蓝节点标（future 才有）
    expect(container.innerHTML).not.toContain("预计")
    // 仍展示或签/可驳回标注
    expect(container.innerHTML).toContain("或签")
  })
})
