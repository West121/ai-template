/**
 * serialize.ts · 脚本任务（scriptTask）往返一致性（N-F-09）。
 *
 * 验证 ProcessModel（含 serviceTask{impl:"script"} + script）经 fromProcessModel → toProcessModel
 * 字节一致，且脚本体字段无损；非脚本 serviceTask 不残留 script 字段。
 */
import { describe, expect, it } from "vitest"
import type { ProcessModel } from "./model"
import { fromProcessModel, toProcessModel } from "./serialize"

function roundTrip(pm: ProcessModel): ProcessModel {
  const rf = fromProcessModel(pm)
  return toProcessModel(rf.nodes, rf.edges, {
    key: pm.key,
    name: pm.name,
    flowConfig: pm.flowConfig,
  })
}

const base = { schemaVersion: 1 as const, key: "k", name: "n" }

describe("serialize · scriptTask 往返", () => {
  it("serviceTask{impl:script} + script 往返字节一致（三种语言）", () => {
    for (const lang of ["groovy", "js", "python"] as const) {
      const pm: ProcessModel = {
        ...base,
        nodes: [
          { id: "start", type: "startEvent", name: "开始", position: { x: 0, y: 0 } },
          {
            id: "sc",
            type: "serviceTask",
            name: "脚本任务",
            position: { x: 0, y: 100 },
            service: { impl: "script" },
            script: { lang, code: 'vars.ok = true\nlog.info("hi")' },
          },
          { id: "end", type: "endEvent", name: "结束", position: { x: 0, y: 200 } },
        ],
        edges: [
          { id: "e1", source: "start", target: "sc" },
          { id: "e2", source: "sc", target: "end" },
        ],
      }
      expect(roundTrip(pm)).toEqual(pm)
      // 脚本体确实被保留
      const node = roundTrip(pm).nodes.find((n) => n.id === "sc")
      expect(node?.type).toBe("serviceTask")
      if (node?.type === "serviceTask") {
        expect(node.service.impl).toBe("script")
        expect(node.script).toEqual({ lang, code: 'vars.ok = true\nlog.info("hi")' })
      }
    }
  })

  it("非脚本 serviceTask 不携带 script 字段", () => {
    const pm: ProcessModel = {
      ...base,
      nodes: [
        {
          id: "svc",
          type: "serviceTask",
          name: "服务任务",
          position: { x: 0, y: 0 },
          service: { impl: "delegate", delegateExpression: "${someBean}" },
        },
      ],
      edges: [],
    }
    const out = roundTrip(pm)
    expect(out).toEqual(pm)
    const node = out.nodes.find((n) => n.id === "svc")
    if (node?.type === "serviceTask") {
      expect(node.script).toBeUndefined()
    }
  })
})
