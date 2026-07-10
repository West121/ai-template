/**
 * serialize.ts · 办理人规则载入归一化（type→kind 兼容）+ 摘要健壮性。
 *
 * 复现并锁死 bug：含旧 `type` 判别字段的 designerJson（如公文种子）进 GRAPH 设计器后，
 * 办理人摘要吐 "undefined（N）"。fromProcessModel 须与 dingtalk 载入口径一致做 type→kind 归一，
 * summarizeAssignees 须防御且优先展示引用名（角色·部门经理）。
 */
import { describe, expect, it } from "vitest"
import type { ProcessModel } from "./model"
import { fromProcessModel, toProcessModel } from "./serialize"
import { summarizeAssignees } from "./summary"
import type { WfNodeProps } from "../types"

/** 构造含单个 userTask（携带任意旧/新形状 assigneeRules）的模型 */
function modelWithRules(rawRules: unknown[]): ProcessModel {
  return {
    schemaVersion: 1,
    key: "gw_send",
    name: "发文办理单",
    nodes: [
      { id: "start", type: "startEvent", name: "开始", position: { x: 0, y: 0 } },
      {
        id: "t",
        type: "userTask",
        name: "审批",
        position: { x: 0, y: 100 },
        // 塞入旧形状（模拟后端/旧 designerJson），故意绕过类型
        props: { assigneeRules: rawRules, multiMode: "ANY" } as unknown as WfNodeProps,
      },
      { id: "end", type: "endEvent", name: "结束", position: { x: 0, y: 200 } },
    ],
    edges: [],
  }
}

function loadedProps(pm: ProcessModel): WfNodeProps | undefined {
  return fromProcessModel(pm).nodes.find((n) => n.id === "t")?.data.props
}

describe("serialize · 办理人 type→kind 归一化 + 摘要", () => {
  it("旧 type=LEADER 归一为 kind=LEADER，摘要显示级别而非 undefined", () => {
    const props = loadedProps(modelWithRules([{ type: "LEADER", level: 2 }]))
    expect(props?.assigneeRules?.[0].kind).toBe("LEADER")
    const s = summarizeAssignees(props)
    expect(s).toBe("第 2 级主管")
    expect(s).not.toContain("undefined")
  })

  it("旧 type=INITIATOR 归一为 kind=INITIATOR", () => {
    const props = loadedProps(modelWithRules([{ type: "INITIATOR" }]))
    expect(props?.assigneeRules?.[0].kind).toBe("INITIATOR")
    expect(summarizeAssignees(props)).toBe("发起人本人")
  })

  it("旧 type=ORG + refs → ACCOUNT·FIXED，摘要优先展示引用名", () => {
    const props = loadedProps(
      modelWithRules([{ type: "ORG", refs: [{ kind: "ROLE", id: 5, name: "部门经理" }] }]),
    )
    const rule = props?.assigneeRules?.[0]
    expect(rule?.kind).toBe("ACCOUNT")
    expect(rule?.source).toBe("FIXED")
    expect(rule?.refs?.[0]).toMatchObject({ type: "ROLE", id: 5, name: "部门经理" })
    // ACCOUNT 引用了角色名 → 账户·部门经理（优先 name，而非「账户（1）」）
    expect(summarizeAssignees(props)).toBe("账户·部门经理")
  })

  it("kind=ROLE + refs(name) 摘要为「角色·部门经理」", () => {
    const props = loadedProps(
      modelWithRules([{ kind: "ROLE", refs: [{ kind: "ROLE", id: 7, name: "部门经理" }] }]),
    )
    expect(summarizeAssignees(props)).toBe("角色·部门经理")
  })

  it("废弃 kind=ROLE_POST → ROLE；FIND_LEADER → LEADER", () => {
    expect(loadedProps(modelWithRules([{ kind: "ROLE_POST" }]))?.assigneeRules?.[0].kind).toBe("ROLE")
    expect(loadedProps(modelWithRules([{ kind: "FIND_LEADER" }]))?.assigneeRules?.[0].kind).toBe("LEADER")
  })

  it("summarizeAssignees 防御：kind/type 全缺失也不吐 undefined", () => {
    // 直接喂空规则，绕过归一化，验证摘要层防御
    const s = summarizeAssignees({ assigneeRules: [{} as never] })
    expect(s).not.toContain("undefined")
    expect(s.length).toBeGreaterThan(0)
  })

  it("已归一化规则幂等：二次归一化 refs 的 type 不退化为 USER，往返一致", () => {
    // 模拟画布内已归一化的规则（refs 用 OrgRef 的 type），再走一次 from→to 应不变形
    const pm: ProcessModel = {
      schemaVersion: 1,
      key: "k",
      name: "n",
      nodes: [
        {
          id: "t",
          type: "userTask",
          name: "审批",
          position: { x: 0, y: 0 },
          props: {
            assigneeRules: [{ kind: "ROLE", source: "FIXED", refs: [{ type: "ROLE", id: 5, name: "经理" }] }],
          },
        },
      ],
      edges: [],
    }
    const rf = fromProcessModel(pm)
    const rule = rf.nodes[0].data.props?.assigneeRules?.[0]
    expect(rule?.kind).toBe("ROLE")
    expect(rule?.refs?.[0]).toMatchObject({ type: "ROLE", id: 5, name: "经理" }) // 未退化成 USER
    const back = toProcessModel(rf.nodes, rf.edges, { key: pm.key, name: pm.name })
    expect(back).toEqual(pm)
  })
})
