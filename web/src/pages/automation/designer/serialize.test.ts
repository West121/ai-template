/**
 * OrchModel 序列化往返用例（契约 §6）：全节点类型 + 条件/默认边经 from→to 字节一致。
 */
import { describe, expect, it } from "vitest"
import type { OrchModel } from "./model"
import { defaultConfig, validateOrchModel } from "./model"
import { fromOrchModel, parseOrchModel, toOrchModel } from "./serialize"

function roundTrip(model: OrchModel): OrchModel {
  const rf = fromOrchModel(model)
  return toOrchModel(rf.nodes, rf.edges, { key: model.key, name: model.name })
}

const DEMO: OrchModel = {
  schemaVersion: 1,
  key: "demo_sync",
  name: "演示编排",
  nodes: [
    { id: "t1", type: "trigger", name: "Webhook 触发", position: { x: 0, y: 0 }, config: { triggerType: "WEBHOOK" } },
    {
      id: "h1",
      type: "http",
      name: "拉取数据",
      position: { x: 0, y: 120 },
      config: {
        method: "POST",
        url: "https://api.example.com/list",
        headers: '{"X-Tenant":"{{payload.tenant}}"}',
        body: '{"page":1}',
        timeoutMs: 10000,
        credentialId: 2,
        responseType: "JSON",
        saveAs: "listResp",
        retry: { times: 3, intervalMs: 1000, backoff: true },
        onError: "ABORT",
      },
    },
    { id: "c1", type: "condition", name: "有数据？", position: { x: 0, y: 240 }, config: {} },
    {
      id: "ai1",
      type: "llm",
      name: "AI 摘要",
      position: { x: -120, y: 360 },
      config: { credentialId: 1, userPrompt: "总结：{{outputs.h1.body}}", outputMode: "JSON", timeoutMs: 60000, saveAs: "summary" },
    },
    {
      id: "n1",
      type: "notify",
      name: "通知管理员",
      position: { x: -120, y: 480 },
      config: { recipients: [{ type: "USER", id: 1, name: "管理员" }], title: "同步完成", content: "{{vars.summary}}" },
    },
    {
      id: "sf1",
      type: "subFlow",
      name: "调子编排",
      position: { x: 120, y: 360 },
      config: { flowCode: "child_flow", payload: [{ field: "docId", expr: "{{payload.docId}}" }], waitResult: true },
    },
    { id: "e1", type: "end", name: "结束", position: { x: 0, y: 600 }, config: { output: "{{vars.summary}}" } },
  ],
  edges: [
    { id: "eg1", source: "t1", target: "h1" },
    { id: "eg2", source: "h1", target: "c1" },
    {
      id: "eg3",
      source: "c1",
      target: "ai1",
      condition: { logic: "AND", items: [{ field: "outputs.h1.body.total", operator: "gt", value: "0" }] },
    },
    { id: "eg4", source: "c1", target: "sf1", isDefault: true },
    { id: "eg5", source: "ai1", target: "n1" },
    { id: "eg6", source: "n1", target: "e1" },
    { id: "eg7", source: "sf1", target: "e1" },
  ],
}

describe("OrchModel 序列化往返", () => {
  it("全节点类型 + 条件/默认边 往返字节一致", () => {
    expect(roundTrip(DEMO)).toEqual(DEMO)
  })

  it("expression 逃生口与空 data 边往返不丢/不多", () => {
    const model: OrchModel = {
      schemaVersion: 1,
      key: "k",
      name: "n",
      nodes: [
        { id: "a", type: "trigger", name: "手动", position: { x: 0, y: 0 }, config: { triggerType: "MANUAL" } },
        { id: "b", type: "end", name: "结束", position: { x: 0, y: 100 }, config: {} },
      ],
      edges: [{ id: "e", source: "a", target: "b", expression: "payload.x > 1" }],
    }
    expect(roundTrip(model)).toEqual(model)
  })

  it("defaultConfig 覆盖全部节点类型（palette 新增可用）", () => {
    const types = [
      "trigger", "http", "script", "condition", "parallel", "loop", "delay",
      "notify", "startApproval", "dataMap", "subFlow", "llm", "end",
    ] as const
    for (const t of types) expect(defaultConfig(t)).toBeDefined()
  })

  it("parseOrchModel：字符串/对象/非法输入", () => {
    expect(parseOrchModel(JSON.stringify(DEMO))?.key).toBe("demo_sync")
    expect(parseOrchModel(DEMO)?.name).toBe("演示编排")
    expect(parseOrchModel("not json")).toBeNull()
    expect(parseOrchModel(null)).toBeNull()
  })

  it("validateOrchModel：演示模型无 error；缺触发/延时超限报 error", () => {
    const issues = validateOrchModel(DEMO)
    expect(issues.filter((i) => i.level === "error")).toEqual([])

    const bad: OrchModel = {
      schemaVersion: 1,
      key: "bad",
      name: "坏流",
      nodes: [{ id: "d", type: "delay", name: "久等", position: { x: 0, y: 0 }, config: { ms: 600000 } }],
      edges: [],
    }
    const badIssues = validateOrchModel(bad)
    expect(badIssues.some((i) => i.level === "error" && i.message.includes("触发节点"))).toBe(true)
    expect(badIssues.some((i) => i.level === "error" && i.message.includes("5 分钟"))).toBe(true)
  })

  it("loopBody / errorBranch 边标记往返不丢，合法拓扑无 error（loop 与 BRANCH 图契约）", () => {
    const model: OrchModel = {
      schemaVersion: 1,
      key: "loop_branch",
      name: "循环与失败分支",
      nodes: [
        { id: "t", type: "trigger", name: "手动", position: { x: 0, y: 0 }, config: { triggerType: "MANUAL" } },
        { id: "lp", type: "loop", name: "遍历", position: { x: 0, y: 100 }, config: { collection: "{{payload.list}}", itemVar: "item", maxIterations: 100 } },
        { id: "h", type: "http", name: "调接口", position: { x: -120, y: 200 }, config: { method: "GET", url: "https://x", onError: "BRANCH" } },
        { id: "n", type: "notify", name: "失败告警", position: { x: -240, y: 300 }, config: { recipients: [], title: "失败", content: "{{payload}}" } },
        { id: "d", type: "dataMap", name: "记录", position: { x: 0, y: 300 }, config: { assignments: [{ target: "ok", expr: "true" }] } },
        { id: "e", type: "end", name: "结束", position: { x: 120, y: 400 }, config: {} },
      ],
      edges: [
        { id: "e0", source: "t", target: "lp" },
        // loop 恰两出边：循环体入口（loopBody）+ 循环后续接
        { id: "e1", source: "lp", target: "h", loopBody: true },
        { id: "e2", source: "lp", target: "e" },
        // BRANCH 恰两出边：失败支（errorBranch）+ 成功支
        { id: "e3", source: "h", target: "n", errorBranch: true },
        { id: "e4", source: "h", target: "d" },
      ],
    }
    expect(roundTrip(model)).toEqual(model)
    expect(validateOrchModel(model).filter((i) => i.level === "error")).toEqual([])
  })

  it("validateOrchModel：loop / BRANCH 出边契约违规报 error", () => {
    // loop 只有 1 条出边
    const loopBad: OrchModel = {
      schemaVersion: 1,
      key: "bad_loop",
      name: "坏循环",
      nodes: [
        { id: "t", type: "trigger", name: "手动", position: { x: 0, y: 0 }, config: { triggerType: "MANUAL" } },
        { id: "lp", type: "loop", name: "遍历", position: { x: 0, y: 100 }, config: { collection: "{{payload.list}}", itemVar: "i" } },
        { id: "e", type: "end", name: "结束", position: { x: 0, y: 200 }, config: {} },
      ],
      edges: [
        { id: "e0", source: "t", target: "lp" },
        { id: "e1", source: "lp", target: "e" },
      ],
    }
    expect(validateOrchModel(loopBad).some((i) => i.level === "error" && i.message.includes("2 条出边"))).toBe(true)

    // BRANCH 两出边但没标失败支 + 非 BRANCH 动作节点多出边
    const branchBad: OrchModel = {
      schemaVersion: 1,
      key: "bad_branch",
      name: "坏分支",
      nodes: [
        { id: "t", type: "trigger", name: "手动", position: { x: 0, y: 0 }, config: { triggerType: "MANUAL" } },
        { id: "h", type: "http", name: "调接口", position: { x: 0, y: 100 }, config: { method: "GET", url: "https://x", onError: "BRANCH" } },
        { id: "h2", type: "http", name: "普通调用", position: { x: 200, y: 100 }, config: { method: "GET", url: "https://y" } },
        { id: "a", type: "end", name: "A", position: { x: -100, y: 200 }, config: {} },
        { id: "b", type: "end", name: "B", position: { x: 100, y: 200 }, config: {} },
      ],
      edges: [
        { id: "e0", source: "t", target: "h" },
        { id: "e1", source: "h", target: "a" },
        { id: "e2", source: "h", target: "b" },
        { id: "e3", source: "h2", target: "a" },
        { id: "e4", source: "h2", target: "b" },
      ],
    }
    const issues = validateOrchModel(branchBad)
    expect(issues.some((i) => i.level === "error" && i.message.includes("失败分支"))).toBe(true)
    expect(issues.some((i) => i.level === "error" && i.message.includes("只能有 1 条出边"))).toBe(true)
  })
})
