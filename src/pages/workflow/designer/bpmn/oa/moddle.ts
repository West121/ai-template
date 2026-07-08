/**
 * OA BPMN moddle 扩展（命名空间 http://oa/bpmn，前缀 oa）
 *
 * 为什么：bpmn-js 只认识标准 BPMN 元素，业务属性（处理人/多人模式/空值策略/按钮白名单…）
 * 无处安放。定义 oa moddle 扩展后，可把这些属性以逐个独立元素（`oa:assigneeRules` /
 * `oa:multiMode` / … / `oa:flowConfig`）写进 UserTask / Process 的
 * `<bpmn:extensionElements>`，随 `saveXML()` 一并持久化，加载时再反序列化回属性面板。
 *
 * 存储策略：每个 oa 元素只挂一个 JSON 或纯文本 body（`isBody: true`），与后端
 * `JsonToBpmnConverter`（addExt/addExtText）逐字段写出的扩展元素一一对应 —— 后端运行时
 * `AssigneeResolver` 按同样的元素名读取，格式必须完全一致（详见 serde.ts 顶部注释）。
 *
 * `xml: { tagAlias: "lowerCase" }` 会把类型名首字母小写作为 XML 标签，例如类型名
 * `AssigneeRules` 序列化/解析的标签是 `oa:assigneeRules`，与转换器写出的标签一致。
 */

/** 生成「仅一个文本/JSON body」的 oa 元素类型描述符 */
const bodyType = (name: string) => ({
  name,
  superClass: ["Element"],
  properties: [{ name: "value", type: "String", isBody: true }],
})

/** moddle 扩展描述符：传入 Modeler 的 moddleExtensions[{ oa }] */
export const oaModdleDescriptor = {
  name: "OA",
  uri: "http://oa/bpmn",
  prefix: "oa",
  xml: { tagAlias: "lowerCase" },
  associations: [],
  types: [
    {
      /** 旧版单块 JSON 配置（挂在 UserTask 的 extensionElements 下）：仅保留用于读取/迁移旧数据 */
      name: "NodeConfig",
      superClass: ["Element"],
      properties: [
        { name: "multiMode", type: "String", isAttr: true },
        { name: "emptyStrategy", type: "String", isAttr: true },
        { name: "showApprovalRecord", type: "Boolean", isAttr: true },
        { name: "value", type: "String", isBody: true },
      ],
    },
    /** 挂在 Process 的 extensionElements 下 */
    bodyType("FlowConfig"),
    /** 挂在 UserTask 的 extensionElements 下：逐个独立元素，与转换器/运行时一一对应 */
    bodyType("AssigneeRules"),
    bodyType("MultiMode"),
    bodyType("EmptyStrategy"),
    bodyType("VoteConfig"),
    bodyType("AllowedOps"),
    bodyType("HandleOptions"),
    bodyType("AuditMenu"),
    bodyType("Timeout"),
    bodyType("FormPerms"),
    bodyType("CommentRequired"),
    bodyType("Events"),
    bodyType("CcUsers"),
    /** 挂在 bpmn:SequenceFlow 的 extensionElements 下：网关分支结构化条件（Task 2 消费，这里先注册） */
    bodyType("Condition"),
  ],
} as const

export const OA_NS = "http://oa/bpmn"

/* ---------- TS 侧配置契约（统一到共享契约：../types 的 WfNodeProps / ../../shared/config 的 FlowConfig） ---------- */

import type { WfNodeProps } from "../../types"
import { defaultHandleOptions } from "../../shared/config"

/** 节点级配置：与仿钉钉设计器共享同一类型（两维办理人模型 + P1/P2/P3 全套字段） */
export type { WfNodeProps }
/** 流程级 / 流程基础信息配置：与仿钉钉设计器共享同一类型（start.scope + taskTitle，无 mobileStart） */
export type { FlowConfig, ProcessBase } from "../../shared/config"
export { defaultFlowConfig } from "../../shared/config"

/** 节点默认配置 */
export function defaultNodeConfig(): WfNodeProps {
  return {
    assigneeRules: [],
    multiMode: "ANY",
    emptyStrategy: "TO_ADMIN",
    ccUsers: [],
    allowedOps: ["approve", "reject", "transfer"],
    handleOptions: defaultHandleOptions(),
  }
}
