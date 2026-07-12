/**
 * 流程图预览增强 · 纯映射层用例（① 节点办理信息 / ② 回放序 / ③ 预测边）。
 */
import { describe, expect, it } from "vitest"
import { buildNodeInfo, buildReplaySteps, forwardReachable, predictedEdgeIds, reachableAncestors, replayFlowEdgeId, stripHtml } from "./runtime-info"
import type { WfTimelineItem } from "@/types/workflow"

const item = (o: Partial<WfTimelineItem>): WfTimelineItem => ({ action: "APPROVE", ...o })

describe("stripHtml（意见摘要去标签截断）", () => {
  it("去 HTML 标签、折叠空白、解实体", () => {
    expect(stripHtml("<p>同意 <b>通过</b></p>")).toBe("同意 通过")
    expect(stripHtml("a&lt;b&gt;&amp;c")).toBe("a<b>&c")
  })
  it("超长截断加省略号；空 → undefined", () => {
    expect(stripHtml("x".repeat(60), 10)).toBe(`${"x".repeat(10)}…`)
    expect(stripHtml(undefined)).toBeUndefined()
    expect(stripHtml("<br/>")).toBeUndefined()
  })
})

describe("buildNodeInfo（timeline→节点办理信息）", () => {
  const timeline: WfTimelineItem[] = [
    item({ nodeId: "start", action: "START", actorName: "张三", createdAt: "2026-07-12T09:00:00", nodeName: "发起" }),
    item({ nodeId: "n1", action: "APPROVE", actorName: "李经理", createdAt: "2026-07-12T10:00:00", comment: "<p>同意</p>" }),
    item({ nodeId: "n1", action: "APPROVE", actorName: "王经理", createdAt: "2026-07-12T11:00:00", comment: "并签同意" }),
    item({ nodeId: "n2", action: "REJECT", actorName: "赵总", createdAt: "2026-07-12T12:00:00", comment: "预算超标" }),
    item({ nodeId: "n1", action: "CC", actorName: "抄送人" }), // 通知类不计办理人
  ]
  const info = buildNodeInfo(timeline, { completed: ["start", "n1"], active: ["n3"] }, [{ nodeId: "n3", nodeName: "复核" }])

  it("多人节点列全部办理人，意见去 HTML", () => {
    expect(info.n1.status).toBe("completed")
    expect(info.n1.assignees.map((a) => a.name)).toEqual(["李经理", "王经理"]) // CC 不计入
    expect(info.n1.assignees[0].opinion).toBe("同意")
  })

  it("驳回动作 → rejected", () => {
    expect(info.n2.status).toBe("rejected")
    expect(info.n2.opinion).toBe("预算超标")
  })

  it("active（highlight/currentNodes）优先于 timeline 完成态；无记录活动节点补 active", () => {
    expect(info.n3.status).toBe("active")
    expect(info.n3.assignees).toEqual([])
  })

  it("加签动作 → addSign", () => {
    const i2 = buildNodeInfo([item({ nodeId: "x", action: "ADD_SIGN", actorName: "补签人", createdAt: "t" })], undefined, undefined)
    expect(i2.x.status).toBe("addSign")
  })

  it("缺 nodeId 的 timeline 项忽略；空输入 → 空对象", () => {
    expect(buildNodeInfo([item({ action: "COMMENT", actorName: "无节点" })], undefined, undefined)).toEqual({})
    expect(buildNodeInfo(undefined, undefined, undefined)).toEqual({})
  })
})

describe("buildReplaySteps（时间序回放）", () => {
  it("按 timeline 顺序取 nodeId，相邻去重", () => {
    const tl: WfTimelineItem[] = [
      item({ nodeId: "start" }),
      item({ nodeId: "n1" }),
      item({ nodeId: "n1" }), // 同节点多次办理相邻去重
      item({ nodeId: "n2" }),
      item({ action: "COMMENT" }), // 无 nodeId 跳过
    ]
    expect(buildReplaySteps(tl)).toEqual(["start", "n1", "n2"])
    expect(buildReplaySteps(undefined)).toEqual([])
  })
})

describe("reachableAncestors（钉钉盒式图走过路径：条件分支只亮命中支）", () => {
  // 真实 leave_approval 拓扑：start→mgr→cond-split→{b_gt3→gm | b_default}→cond-merge→cc1→end
  const edges = [
    { source: "start", target: "mgr" },
    { source: "mgr", target: "cond-split" },
    { source: "cond-split", target: "b_gt3" },
    { source: "b_gt3", target: "gm" },
    { source: "cond-split", target: "b_default" },
    { source: "gm", target: "cond-merge" },
    { source: "b_default", target: "cond-merge" },
    { source: "cond-merge", target: "cc1" },
    { source: "cc1", target: "end" },
  ]
  it("gm(active) 处：命中支 b_gt3 走过，未命中支 b_default 不走过", () => {
    // 已到达锚点：start/mgr(completed) + gm(active)
    const walked = reachableAncestors(edges, ["start", "mgr", "gm"])
    expect([...walked].sort()).toEqual(["b_gt3", "cond-split", "gm", "mgr", "start"])
    expect(walked.has("b_default")).toBe(false) // 未命中分支保持灰
    expect(walked.has("cond-merge")).toBe(false) // 尚未汇聚
    // 走过的边 = 两端都在集合内
    const walkedEdge = (s: string, t: string) => walked.has(s) && walked.has(t)
    expect(walkedEdge("cond-split", "b_gt3")).toBe(true) // 命中分支入线高亮
    expect(walkedEdge("b_gt3", "gm")).toBe(true) // 进入 active 的入线高亮
    expect(walkedEdge("cond-split", "b_default")).toBe(false) // 未命中分支入线保持灰
  })
  it("并行汇聚：合并节点已到达时两个父支都回溯到（都走过）", () => {
    const par = [
      { source: "fork", target: "a" },
      { source: "fork", target: "b" },
      { source: "a", target: "join" },
      { source: "b", target: "join" },
    ]
    const walked = reachableAncestors(par, ["join"])
    expect([...walked].sort()).toEqual(["a", "b", "fork", "join"])
  })
  it("空种子 → 空集", () => {
    expect(reachableAncestors(edges, []).size).toBe(0)
  })
})

describe("forwardReachable（预测态后续段：当前节点正向可达）", () => {
  const edges = [
    { source: "start", target: "mgr" },
    { source: "mgr", target: "cond-split" },
    { source: "cond-split", target: "b_gt3" },
    { source: "b_gt3", target: "gm" },
    { source: "gm", target: "cond-merge" },
    { source: "cond-merge", target: "cc1" },
    { source: "cc1", target: "end" },
  ]
  it("从当前 gm 正向 → 后续 cond-merge/cc1/end（含种子 gm）", () => {
    expect([...forwardReachable(edges, ["gm"])].sort()).toEqual(["cc1", "cond-merge", "end", "gm"])
  })
  it("空种子 → 空集", () => {
    expect(forwardReachable(edges, []).size).toBe(0)
  })
})

describe("predictedEdgeIds / replayFlowEdgeId（边推导）", () => {
  const edges = [
    { id: "e1", source: "cur", target: "p1" },
    { id: "e2", source: "p1", target: "p2" },
    { id: "e3", source: "other", target: "z" },
  ]
  it("预测边：source∈active∪predicted 且 target∈predicted", () => {
    const set = predictedEdgeIds(edges, ["p1", "p2"], ["cur"])
    expect([...set].sort()).toEqual(["e1", "e2"])
  })
  it("回放流光边：steps[i-1]→steps[i]", () => {
    expect(replayFlowEdgeId(edges, ["cur", "p1", "p2"], 1)).toBe("e1")
    expect(replayFlowEdgeId(edges, ["cur", "p1", "p2"], 2)).toBe("e2")
    expect(replayFlowEdgeId(edges, ["cur", "p1"], 0)).toBeNull()
  })
})
