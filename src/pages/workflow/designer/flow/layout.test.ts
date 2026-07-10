/**
 * layout.ts · 自动布局往返一致性（收尾三小项 · 项1）。
 *
 * 断言：dagre 自动布局**只改 position**——布局后经 toProcessModel 序列化，
 * 除各节点坐标外，节点 data（size/props/service/script…）、边、条件全部无损；
 * 且「布局 → 序列化 → 反序列化 → 序列化」二次往返字节一致（position 稳定收敛）。
 */
import { describe, expect, it } from "vitest"
import type { ProcessModel } from "./model"
import { fromProcessModel, toProcessModel } from "./serialize"
import { layoutFlow, needsLayout } from "./layout"

const base = { schemaVersion: 1 as const, key: "k", name: "n" }

/** 一个含网关分支、条件、脚本任务、终止端的代表性模型，故意把坐标全塞到兜底位 (0,0)。 */
const DEGENERATE: ProcessModel = {
  ...base,
  nodes: [
    { id: "start", type: "startEvent", name: "开始", position: { x: 0, y: 0 } },
    {
      id: "apply",
      type: "userTask",
      name: "部门审批",
      position: { x: 0, y: 0 },
      props: { assigneeRules: [{ kind: "LEADER", level: 1 }], multiMode: "ANY" },
    },
    { id: "gw", type: "exclusiveGateway", name: "金额", position: { x: 0, y: 0 } },
    {
      id: "mgr",
      type: "userTask",
      name: "总经理",
      position: { x: 0, y: 0 },
      props: { assigneeRules: [], multiMode: "ANY" },
    },
    {
      id: "reject",
      type: "serviceTask",
      name: "自动驳回",
      position: { x: 0, y: 0 },
      service: { impl: "autoReject" },
    },
    { id: "term", type: "endEvent", name: "终止", position: { x: 0, y: 0 }, terminate: true },
    { id: "end", type: "endEvent", name: "结束", position: { x: 0, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "start", target: "apply" },
    { id: "e2", source: "apply", target: "gw" },
    {
      id: "e3",
      source: "gw",
      target: "mgr",
      condition: { logic: "AND", items: [{ field: "days", operator: "gt", value: "3" }] },
    },
    { id: "e4", source: "gw", target: "reject", isDefault: true },
    { id: "e5", source: "reject", target: "term" },
    { id: "e6", source: "mgr", target: "end" },
  ],
}

/** 剥离坐标，用于「除 position 外一切不变」的断言。 */
function stripPositions(pm: ProcessModel): ProcessModel {
  return {
    ...pm,
    nodes: pm.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
  }
}

describe("layout · 自动布局", () => {
  it("兜底坐标可被 needsLayout 识别", () => {
    const rf = fromProcessModel(DEGENERATE)
    expect(needsLayout(rf.nodes)).toBe(true)
  })

  it("布局只改 position：其余字段（含条件/脚本/多实例/终止）无损", () => {
    const rf = fromProcessModel(DEGENERATE)
    const laid = layoutFlow(rf.nodes, rf.edges)
    const out = toProcessModel(laid, rf.edges, { key: DEGENERATE.key, name: DEGENERATE.name })
    // 除坐标外与原模型完全一致
    expect(stripPositions(out)).toEqual(stripPositions(DEGENERATE))
    // 坐标确实被摊开（不再全部重合）
    expect(needsLayout(laid)).toBe(false)
  })

  it("布局后序列化 → 反序列化 → 再序列化 字节一致（往返稳定）", () => {
    const rf = fromProcessModel(DEGENERATE)
    const laid = layoutFlow(rf.nodes, rf.edges)
    const pm1 = toProcessModel(laid, rf.edges, { key: DEGENERATE.key, name: DEGENERATE.name })
    const back = fromProcessModel(pm1)
    const pm2 = toProcessModel(back.nodes, back.edges, { key: pm1.key, name: pm1.name })
    expect(pm2).toEqual(pm1)
  })

  it("空图 / 单点安全返回", () => {
    expect(layoutFlow([], [])).toEqual([])
    expect(needsLayout([])).toBe(false)
  })
})
