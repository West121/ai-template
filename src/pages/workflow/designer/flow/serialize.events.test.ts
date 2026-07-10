/**
 * serialize.ts · 事件监听器往返一致性（节点事件 + 流程事件；含 SCRIPT / API 动作）。
 *
 * 验证：
 *  - 节点事件挂在 WfNodeProps.events，随 node.props 整体往返（fromProcessModel → toProcessModel 字节一致）；
 *  - 流程事件挂在 FlowConfig.events，随 meta.flowConfig → model.flowConfig 整体往返；
 *  - SCRIPT（script.lang/code）与 API（api.method/url/headers/body）字段全部无损。
 */
import { describe, expect, it } from "vitest"
import type { NodeEvent } from "../types"
import type { FlowConfig, ProcessEvent } from "../shared/config"
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

const nodeEvents: NodeEvent[] = [
  { trigger: "TASK_AFTER_CREATED", action: "NOTIFY", notify: { to: [], template: "任务已创建" } },
  { trigger: "TASK_BEFORE_COMPLETE", action: "WEBHOOK", webhookUrl: "https://hook.example/wf" },
  { trigger: "TASK_AFTER_COMPLETE", action: "SCRIPT", script: { lang: "groovy", code: 'vars.ok = true\nreturn vars.ok' } },
  {
    trigger: "TASK_AFTER_UNDO",
    action: "API",
    api: { method: "POST", url: "https://api.example/notify", headers: "Content-Type: application/json", body: '{ "id": "${instanceId}" }' },
  },
]

const processEvents: ProcessEvent[] = [
  { trigger: "PROCESS_START", action: "SCRIPT", script: { lang: "js", code: "vars.started = true" } },
  {
    trigger: "PROCESS_END",
    action: "API",
    api: { method: "PUT", url: "https://api.example/close", headers: "", body: "" },
  },
  { trigger: "PROCESS_CANCEL", action: "NOTIFY", notify: { to: [], template: "流程已撤销" } },
]

const flowConfig: FlowConfig = {
  operations: { terminate: true, retrieve: false, urge: false, cancel: true },
  start: { scope: [], taskTitle: "" },
  variables: [],
  events: processEvents,
}

describe("serialize · 事件监听器往返", () => {
  it("节点事件（NOTIFY/WEBHOOK/SCRIPT/API）随 props 往返字节一致", () => {
    const pm: ProcessModel = {
      schemaVersion: 1,
      key: "k",
      name: "n",
      nodes: [
        { id: "start", type: "startEvent", name: "开始", position: { x: 0, y: 0 } },
        { id: "t", type: "userTask", name: "审批", position: { x: 0, y: 100 }, props: { events: nodeEvents } },
        { id: "end", type: "endEvent", name: "结束", position: { x: 0, y: 200 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "t" },
        { id: "e2", source: "t", target: "end" },
      ],
    }
    const out = roundTrip(pm)
    expect(out).toEqual(pm)
    const node = out.nodes.find((n) => n.id === "t")
    expect(node?.props?.events).toEqual(nodeEvents)
    // SCRIPT / API 载荷确实无损
    expect(node?.props?.events?.[2].script).toEqual({ lang: "groovy", code: 'vars.ok = true\nreturn vars.ok' })
    expect(node?.props?.events?.[3].api).toEqual({
      method: "POST",
      url: "https://api.example/notify",
      headers: "Content-Type: application/json",
      body: '{ "id": "${instanceId}" }',
    })
  })

  it("流程事件（含 SCRIPT/API）随 flowConfig 往返字节一致", () => {
    const pm: ProcessModel = {
      schemaVersion: 1,
      key: "k",
      name: "n",
      flowConfig,
      nodes: [{ id: "start", type: "startEvent", name: "开始", position: { x: 0, y: 0 } }],
      edges: [],
    }
    const out = roundTrip(pm)
    expect(out).toEqual(pm)
    expect(out.flowConfig?.events).toEqual(processEvents)
    expect(out.flowConfig?.events?.[0].script).toEqual({ lang: "js", code: "vars.started = true" })
    expect(out.flowConfig?.events?.[1].api).toEqual({ method: "PUT", url: "https://api.example/close", headers: "", body: "" })
  })
})
