// @vitest-environment jsdom
/**
 * FlowViewer 渲染冒烟（流程图预览增强）：空模型空态 + 带 nodeInfo/replay/predict 挂载不抛错，
 * 且回放/预测控制按钮按数据条件出现。react-flow 需 ResizeObserver/matchMedia polyfill。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { FlowViewer } from "./flow-viewer"
import type { ProcessModel } from "./model"

beforeAll(() => {
  // react-flow 依赖
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO)
  if (!window.matchMedia) {
    vi.stubGlobal(
      "matchMedia",
      (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }),
    )
  }
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})
vi.spyOn(console, "warn").mockImplementation(() => {})

const model: ProcessModel = {
  schemaVersion: 1,
  key: "p",
  name: "测试流程",
  nodes: [
    { id: "start", name: "开始", type: "startEvent", position: { x: 0, y: 0 } },
    { id: "n1", name: "部门审批", type: "userTask", position: { x: 200, y: 0 } },
    { id: "n2", name: "总经理审批", type: "userTask", position: { x: 400, y: 0 } },
    { id: "end", name: "结束", type: "endEvent", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "start", target: "n1" },
    { id: "e2", source: "n1", target: "n2" },
    { id: "e3", source: "n2", target: "end" },
  ],
}

describe("FlowViewer 渲染冒烟", () => {
  it("空模型 → 空态占位", () => {
    render(<FlowViewer model={{ schemaVersion: 1, key: "e", name: "空", nodes: [], edges: [] }} />)
    expect(screen.getByText("暂无流程图")).toBeTruthy()
  })

  it("带 nodeInfo + replaySteps（≥2）→ 挂载不抛错，显示「回放」按钮", () => {
    render(
      <FlowViewer
        model={model}
        highlight={{ completed: ["start", "n1"], active: ["n2"] }}
        nodeInfo={{
          start: { status: "completed", assignees: [{ name: "张三", time: "2026-07-12T09:00:00" }] },
          n1: { status: "completed", assignees: [{ name: "李经理", time: "2026-07-12T10:00:00", opinion: "同意" }] },
          n2: { status: "active", assignees: [] },
        }}
        replaySteps={["start", "n1", "n2"]}
      />,
    )
    expect(screen.getByRole("button", { name: "回放" })).toBeTruthy()
  })

  it("predictable（onRequestPredict）→ 显示「预测运行」按钮", () => {
    render(<FlowViewer model={model} highlight={{ completed: ["start"], active: ["n1"] }} onRequestPredict={() => {}} />)
    expect(screen.getByRole("button", { name: /预测运行/ })).toBeTruthy()
  })

  it("已有 predict 数据 → 显示「播放预测」按钮", () => {
    render(
      <FlowViewer
        model={model}
        highlight={{ completed: ["start"], active: ["n1"] }}
        predict={{ nodeIds: ["n2", "end"], assignees: { n2: ["王经理"] } }}
      />,
    )
    expect(screen.getByRole("button", { name: "播放预测" })).toBeTruthy()
  })
})
