/**
 * GRAPH 流程设计器连线方向校验（双向）——与自动化同款「叠 source+target」结构性修复
 * （ConnectionMode.Loose + 每边单 source handle）的方向护栏；方向由 validateConnection 严格判定。
 */
import { describe, expect, it } from "vitest"
import { validateConnection, type ConnectionEndpoint } from "./validate"

const ep = (id: string, type: ConnectionEndpoint["type"]): ConnectionEndpoint => ({ id, type })
const start = ep("start", "startEvent")
const end = ep("end", "endEvent")
const task = ep("t1", "userTask")
const boundary = ep("b1", "timerBoundary")

describe("validateConnection 方向校验", () => {
  it("任务 → 结束：可连", () => {
    expect(validateConnection(task, end, []).ok).toBe(true)
  })
  it("结束 → 任务：被拒（结束不能有出边）", () => {
    const r = validateConnection(end, task, [])
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("结束")
  })
  it("任务 → 开始：被拒（开始不能有入边）", () => {
    const r = validateConnection(task, start, [])
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("开始")
  })
  it("开始 → 任务：可连（开始只出）", () => {
    expect(validateConnection(start, task, []).ok).toBe(true)
  })
  it("→ 边界定时事件：被拒（附着绑定，不接受入边）", () => {
    expect(validateConnection(task, boundary, []).ok).toBe(false)
  })
  it("自连 / 同向重复：被拒", () => {
    expect(validateConnection(task, task, []).ok).toBe(false)
    expect(validateConnection(start, task, [{ source: "start", target: "t1" }]).ok).toBe(false)
  })
})
