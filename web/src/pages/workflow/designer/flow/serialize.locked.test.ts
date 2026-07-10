/**
 * serialize.ts · 系统锁定节点（locked）往返一致性 + deletable 拦截。
 *
 * 公文 gw_send/gw_recv 的关键回写节点由磐石在种子 designerJson 打 `locked:true`；
 * 设计器载入/保存必须原样 passthrough 该字段（否则回写按 node id 触发的绑定会失联），
 * 且载入后对应 react-flow 节点须 deletable=false（拦截键盘/deleteElements 删除）。
 */
import { describe, expect, it } from "vitest"
import type { ProcessModel } from "./model"
import { fromProcessModel, toProcessModel } from "./serialize"

function roundTrip(pm: ProcessModel): ProcessModel {
  const rf = fromProcessModel(pm)
  return toProcessModel(rf.nodes, rf.edges, {
    key: pm.key,
    name: pm.name,
    formKey: pm.formKey,
    flowConfig: pm.flowConfig,
  })
}

const base = { schemaVersion: 1 as const, key: "gw_send", name: "发文办理单" }

describe("serialize · locked 系统节点往返", () => {
  it("locked 节点经 fromProcessModel→toProcessModel 字节一致（passthrough 不丢）", () => {
    const pm: ProcessModel = {
      ...base,
      nodes: [
        { id: "start", type: "startEvent", name: "开始", position: { x: 0, y: 0 } },
        {
          id: "issue",
          type: "userTask",
          name: "签发",
          position: { x: 0, y: 100 },
          locked: true,
          props: { assigneeRules: [{ kind: "LEADER", level: 1 }], multiMode: "ANY" },
        },
        {
          id: "seal",
          type: "userTask",
          name: "用印",
          position: { x: 0, y: 200 },
          locked: true,
        },
        // 非锁定普通节点
        { id: "extra", type: "userTask", name: "会办", position: { x: 0, y: 300 } },
        { id: "end", type: "endEvent", name: "结束", position: { x: 0, y: 400 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "issue" },
        { id: "e2", source: "issue", target: "seal" },
        { id: "e3", source: "seal", target: "extra" },
        { id: "e4", source: "extra", target: "end" },
      ],
    }
    expect(roundTrip(pm)).toEqual(pm)

    // locked 保留在锁定节点、且未泄漏到普通节点
    const out = roundTrip(pm)
    expect(out.nodes.find((n) => n.id === "issue")?.locked).toBe(true)
    expect(out.nodes.find((n) => n.id === "seal")?.locked).toBe(true)
    expect(out.nodes.find((n) => n.id === "extra")?.locked).toBeUndefined()
    expect(out.nodes.find((n) => n.id === "start")?.locked).toBeUndefined()
  })

  it("fromProcessModel 给 locked 节点设 deletable=false，普通节点不设", () => {
    const pm: ProcessModel = {
      ...base,
      nodes: [
        { id: "review", type: "userTask", name: "核稿", position: { x: 0, y: 0 }, locked: true },
        { id: "free", type: "userTask", name: "自由节点", position: { x: 0, y: 100 } },
      ],
      edges: [],
    }
    const rf = fromProcessModel(pm)
    expect(rf.nodes.find((n) => n.id === "review")?.deletable).toBe(false)
    expect(rf.nodes.find((n) => n.id === "review")?.data.locked).toBe(true)
    // 普通节点不显式设 deletable（沿用 react-flow 默认可删）
    expect(rf.nodes.find((n) => n.id === "free")?.deletable).toBeUndefined()
    expect(rf.nodes.find((n) => n.id === "free")?.data.locked).toBeUndefined()
  })

  it("节点改名/改办理人后 locked 与 id 仍保留（模拟设计器编辑）", () => {
    const pm: ProcessModel = {
      ...base,
      nodes: [{ id: "publish", type: "userTask", name: "成文分发", position: { x: 0, y: 0 }, locked: true }],
      edges: [],
    }
    const rf = fromProcessModel(pm)
    // 模拟设计器 updateNodeName / updateNodeProps：只改 data.name / data.props，保留 id 与 locked
    const edited = rf.nodes.map((n) => ({
      ...n,
      data: { ...n.data, name: "成文与分发", props: { assigneeRules: [{ kind: "ACCOUNT" as const, source: "FIXED" as const, refs: [] }] } },
    }))
    const out = toProcessModel(edited, rf.edges, { key: pm.key, name: pm.name })
    const node = out.nodes.find((n) => n.id === "publish")
    expect(node?.id).toBe("publish")
    expect(node?.locked).toBe(true)
    expect(node?.name).toBe("成文与分发")
  })
})
