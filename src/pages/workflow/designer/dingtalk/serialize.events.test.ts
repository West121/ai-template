/**
 * dingtalk/serialize.ts · 事件监听器 blocking / delegate 往返（DINGTALK 设计器）。
 *
 * 节点事件挂在审批节点 WfNodeProps.events（serializeDingtalk → BackendNode.events → deserializeDingtalk 回 nodeProps.events）；
 * 流程事件挂在 FlowConfig.events。验证新增 blocking（阻断标记）与 delegate（自定义监听器 bean）字段无损往返。
 */
import { describe, expect, it } from "vitest"
import type { NodeEvent } from "../types"
import type { FlowConfig, ProcessEvent } from "../shared/config"
import { defaultFlowConfig } from "../shared/config"
import type { StepNode } from "./model"
import type { NodePropsMap } from "../types"
import { deserializeDingtalk, serializeDingtalk } from "./serialize"

describe("dingtalk serialize · 事件 blocking / delegate 往返", () => {
  it("审批节点 events（含 blocking + DELEGATE）随 nodeProps 往返无损", () => {
    const events: NodeEvent[] = [
      { trigger: "TASK_BEFORE_COMPLETE", action: "SCRIPT", blocking: true, script: { lang: "groovy", code: "return true" } },
      { trigger: "TASK_BEFORE_UNDO", action: "DELEGATE", blocking: true, delegate: { bean: "demoBudgetGuard" } },
      { trigger: "TASK_AFTER_COMPLETE", action: "DELEGATE", delegate: { bean: "auditLogger" } },
    ]
    const steps: StepNode[] = [
      { id: "n1", kind: "approval", name: "审批", assignees: [], mode: "any" },
    ]
    const nodeProps: NodePropsMap = { n1: { assigneeRules: [], multiMode: "ANY", events } }

    const json = serializeDingtalk(steps, nodeProps, defaultFlowConfig())
    const back = deserializeDingtalk(json)

    expect(back.nodeProps.n1?.events).toEqual(events)
    expect(back.nodeProps.n1?.events?.[0].blocking).toBe(true)
    expect(back.nodeProps.n1?.events?.[1].delegate).toEqual({ bean: "demoBudgetGuard" })
    expect(back.nodeProps.n1?.events?.[2].blocking).toBeUndefined()
  })

  it("流程事件 events（PROCESS_START 阻断 + DELEGATE）随 flowConfig 往返无损", () => {
    const events: ProcessEvent[] = [
      { trigger: "PROCESS_START", action: "DELEGATE", blocking: true, delegate: { bean: "startGuard" } },
    ]
    const flowConfig: FlowConfig = { ...defaultFlowConfig(), events }
    const steps: StepNode[] = [{ id: "n1", kind: "approval", name: "审批", assignees: [], mode: "any" }]

    const json = serializeDingtalk(steps, { n1: { assigneeRules: [], multiMode: "ANY" } }, flowConfig)
    const back = deserializeDingtalk(json)

    expect(back.flowConfig.events).toEqual(events)
    expect(back.flowConfig.events?.[0].blocking).toBe(true)
    expect(back.flowConfig.events?.[0].delegate).toEqual({ bean: "startGuard" })
  })
})
