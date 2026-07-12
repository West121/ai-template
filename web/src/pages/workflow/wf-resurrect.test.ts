/**
 * 唤醒重新选人 · 预览取数用例（mock 派生 + 端点回退分支）。
 */
import { describe, expect, it, vi, afterEach } from "vitest"
import { mockResurrectPreview, fetchResurrectPreview } from "./wf-resurrect"
import type { WfTimelineItem } from "@/types/workflow"

const tl: WfTimelineItem[] = [
  { action: "APPROVE", nodeId: "n1", actorName: "李经理", createdAt: "t1" },
  { action: "APPROVE", nodeId: "n1", actorName: "王经理", createdAt: "t2" },
  { action: "APPROVE", nodeId: "n1", actorName: "李经理", createdAt: "t3" }, // 去重
  { action: "APPROVE", nodeId: "n2", actorName: "赵总", createdAt: "t4" },
]

describe("mockResurrectPreview（timeline 派生历史办理人）", () => {
  it("取该节点历史办理人去重、保序，负 id 占位", () => {
    const p = mockResurrectPreview("n1", "部门审批", tl)
    expect(p.nodeName).toBe("部门审批")
    expect(p.historyAssignees).toEqual([
      { id: -1, name: "李经理" },
      { id: -2, name: "王经理" },
    ])
    expect(p.ruleAssignees?.length).toBeGreaterThan(0)
  })
  it("无匹配节点 → 空历史", () => {
    expect(mockResurrectPreview("zzz", undefined, tl).historyAssignees).toEqual([])
    expect(mockResurrectPreview("n1", undefined, undefined).historyAssignees).toEqual([])
  })
})

/* fetch 分支：mock fetch 让端点 404 → 回退演示；成功 → 归一 */
const origFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = origFetch
  vi.restoreAllMocks()
})

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () => ({
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe("fetchResurrectPreview（端点优先 / 404 回退演示）", () => {
  it("端点 404（envelope code 404）→ demo 演示预填", async () => {
    stubFetch(200, { code: 404, message: "not found", data: null })
    const res = await fetchResurrectPreview(1, "n1", "部门审批", tl)
    expect(res.demo).toBe(true)
    expect(res.data.historyAssignees[0].name).toBe("李经理")
  })

  it("端点成功 → 真实数据，historyAssignees 归一（滤非法项）", async () => {
    stubFetch(200, {
      code: 0,
      data: { nodeName: "部门审批", historyAssignees: [{ id: 7, name: "张三" }, { id: null, name: "x" }, { name: "缺id" }], ruleAssignees: [{ name: "主管" }] },
    })
    const res = await fetchResurrectPreview(1, "n1", undefined, tl)
    expect(res.demo).toBe(false)
    expect(res.data.historyAssignees).toEqual([{ id: 7, name: "张三" }])
    expect(res.data.ruleAssignees).toEqual([{ name: "主管" }])
  })
})
