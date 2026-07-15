/**
 * 自动化编排连线方向校验（双向）——修「脚本拖不出线到结束/结束反能拖到脚本」的护栏。
 * 结构性修复是 ConnectionMode.Loose + 每边单 source handle；方向仍由 checkConnection 严格判定。
 */
import { describe, expect, it } from "vitest"
import type { Connection } from "@xyflow/react"
import { checkConnection, type OrchRfNode, type OrchRfEdge } from "./serialize"

function node(id: string, type: string): OrchRfNode {
  return { id, type, position: { x: 0, y: 0 }, data: { name: id, config: {} } } as OrchRfNode
}
const conn = (source: string, target: string): Connection => ({ source, target, sourceHandle: null, targetHandle: null })

const script = node("script1", "script")
const end = node("end1", "end")
const trigger = node("trigger1", "trigger")

describe("checkConnection 方向校验", () => {
  it("脚本 → 结束：可连（null）", () => {
    expect(checkConnection(script, end, [], conn("script1", "end1"))).toBeNull()
  })
  it("结束 → 脚本：被拒（结束不能有出边）", () => {
    expect(checkConnection(end, script, [], conn("end1", "script1"))).toBe("结束节点不能有出边")
  })
  it("脚本 → 触发：被拒（触发不能有入边）", () => {
    expect(checkConnection(script, trigger, [], conn("script1", "trigger1"))).toBe("触发节点不能有入边")
  })
  it("触发 → 脚本：可连（触发只出）", () => {
    expect(checkConnection(trigger, script, [], conn("trigger1", "script1"))).toBeNull()
  })
  it("自连 / 同向重复：被拒", () => {
    expect(checkConnection(script, script, [], conn("script1", "script1"))).toBe("不能连接自身")
    const edges = [{ id: "e1", source: "script1", target: "end1" } as OrchRfEdge]
    expect(checkConnection(script, end, edges, conn("script1", "end1"))).toBe("已存在同向连线")
  })
})
