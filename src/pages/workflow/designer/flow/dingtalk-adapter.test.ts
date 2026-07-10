/**
 * dingtalk-adapter.ts · 钉钉 designerJson → ProcessModel 迁移（收尾三小项 · 项3）。
 *
 * 断言树→图转写：合成 start/end、条件分支展开为成对网关 + 出边、分支条件搬到 edge.condition、
 * 默认分支搬到 edge.isDefault、autoReject 尾接 terminate end，且产物本身序列化往返一致。
 */
import { describe, expect, it } from "vitest"
import { fromProcessModel, toProcessModel } from "./serialize"
import { dingtalkToProcessModel } from "./dingtalk-adapter"

describe("dingtalk-adapter · 树→图迁移", () => {
  it("线性 + 条件分支：合成 start/end + 成对网关 + 条件/默认搬到边", () => {
    const designerJson = {
      nodes: [
        {
          id: "n1",
          type: "approval",
          name: "部门审批",
          assigneeRules: [{ kind: "LEADER", level: 1 }],
          multiMode: "ANY",
          emptyStrategy: "TO_ADMIN",
        },
        {
          id: "n2",
          type: "condition",
          name: "金额判断",
          branches: [
            {
              id: "b1",
              name: "大额",
              conditions: [{ field: "days", operator: ">", value: 3 }],
              steps: [
                {
                  id: "n3",
                  type: "approval",
                  name: "总经理",
                  assigneeRules: [],
                  multiMode: "ANY",
                  emptyStrategy: "TO_ADMIN",
                },
              ],
            },
            { id: "b2", name: "默认", conditions: [], default: true, steps: [] },
          ],
        },
        { id: "n4", type: "cc", name: "抄送", users: [] },
      ],
    }

    const pm = dingtalkToProcessModel(designerJson, { key: "leave", name: "请假" })

    // 合成的一等节点
    const types = new Map(pm.nodes.map((n) => [n.id, n.type]))
    expect(types.get("start")).toBe("startEvent")
    expect(types.get("end")).toBe("endEvent")
    expect(types.get("n1")).toBe("userTask")
    expect(types.get("n2_split")).toBe("exclusiveGateway")
    expect(types.get("n2_join")).toBe("exclusiveGateway")
    expect(types.get("n3")).toBe("userTask")
    expect(types.get("n4")).toBe("cc")

    // 分支条件搬到边（operator 符号 ">" → 枚举 gt，值转字符串）
    const condEdge = pm.edges.find((e) => e.source === "n2_split" && e.target === "n3")
    expect(condEdge?.condition).toEqual({ logic: "AND", items: [{ field: "days", operator: "gt", value: "3" }] })

    // 默认分支搬到 edge.isDefault，且不带 condition
    const defEdge = pm.edges.find((e) => e.source === "n2_split" && e.target === "n2_join")
    expect(defEdge?.isDefault).toBe(true)
    expect(defEdge?.condition).toBeUndefined()

    // 汇聚回流 + 链路连通：n3→join、join→n4、n4→end、start→n1、n1→split
    expect(pm.edges.some((e) => e.source === "n3" && e.target === "n2_join")).toBe(true)
    expect(pm.edges.some((e) => e.source === "n2_join" && e.target === "n4")).toBe(true)
    expect(pm.edges.some((e) => e.source === "n4" && e.target === "end")).toBe(true)
    expect(pm.edges.some((e) => e.source === "start" && e.target === "n1")).toBe(true)
    expect(pm.edges.some((e) => e.source === "n1" && e.target === "n2_split")).toBe(true)

    // 承接审批人属性（approval.props 迁移）
    const n1 = pm.nodes.find((n) => n.id === "n1")
    expect(n1?.props?.assigneeRules?.[0]?.kind).toBe("LEADER")

    // dagre 已补坐标（不再全 0）
    expect(pm.nodes.some((n) => n.position.x !== 0 || n.position.y !== 0)).toBe(true)

    // 产物序列化往返一致
    const rf = fromProcessModel(pm)
    const pm2 = toProcessModel(rf.nodes, rf.edges, {
      key: pm.key,
      name: pm.name,
      formKey: pm.formKey,
      flowConfig: pm.flowConfig,
    })
    expect(pm2).toEqual(pm)
  })

  it("autoReject 尾接 terminate 结束事件", () => {
    const designerJson = {
      nodes: [
        { id: "r1", type: "autoReject", name: "自动驳回" },
      ],
    }
    const pm = dingtalkToProcessModel(designerJson)
    const term = pm.nodes.find((n) => n.type === "endEvent" && n.terminate === true)
    expect(term).toBeTruthy()
    expect(pm.edges.some((e) => e.source === "r1" && e.target === term?.id)).toBe(true)
    // start→r1 存在；r1 之后除 terminate 外无开放出口（未连普通 end）
    expect(pm.edges.some((e) => e.source === "start" && e.target === "r1")).toBe(true)
  })

  it("非钉钉后端格式抛清晰错误", () => {
    expect(() => dingtalkToProcessModel({ foo: 1 })).toThrow(/无法识别的钉钉/)
  })
})
