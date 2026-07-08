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
    /** 展示审批记录：BPMN 设计器本地展示开关，后端不消费，独立元素持久化避免刷新丢失 */
    bodyType("ShowApprovalRecord"),
  ],
} as const

export const OA_NS = "http://oa/bpmn"

/* ---------- TS 侧配置契约（对齐 docs/flow-designer-v2.md P1 数据契约 nodeConfig / flowConfig） ---------- */

import type { OrgRef } from "@/components/org-picker"
import type {
  AssigneeRule,
  AuditMenu,
  EmptyStrategy,
  FormPerms,
  HandleOptions,
  MultiMode,
  NodeEvent,
  NodeTimeout,
  VoteConfig,
} from "../../types"
import type { FlowVariable } from "../../shared/config"
import { defaultHandleOptions } from "../../shared/config"

/**
 * 节点级配置（UserTask）。逐字段以独立 oa:<name> 元素存入 extensionElements，随 saveXML 持久化。
 * assigneeRules/multiMode/emptyStrategy/voteConfig 等类型来自共享契约（../types），与仿钉钉设计器
 * 及后端保持一致的两维（类型×来源）办理人模型。
 */
export interface NodeConfig {
  /** 处理人规则（两维模型：类型(kind) × 来源(source)，与仿钉钉设计器共享） */
  assigneeRules: AssigneeRule[]
  /** 多人模式：或签(ANY) / 会签(ALL) / 依次(SEQUENCE) / 票签(VOTE) */
  multiMode: MultiMode
  /** 空值策略 */
  emptyStrategy: EmptyStrategy
  /** 抄送人（抄送节点用，仍是 OrgRef[]） */
  ccUsers: OrgRef[]
  /** 按钮操作白名单（对应后端 allowedOps） */
  allowedOps: string[]
  /** 是否展示审批记录（BPMN 设计器本地展示，后端不消费） */
  showApprovalRecord: boolean
  /** 办理选项（P2 全套，共享契约） */
  handleOptions: HandleOptions
  /** multiMode=VOTE 时的票签配置（阈值 + 权重） */
  voteConfig?: VoteConfig
  /** P2：审核菜单（跳转/退回） */
  auditMenu?: AuditMenu
  /** P2：审批意见必填 */
  commentRequired?: boolean
  /** P2：节点超时 */
  timeout?: NodeTimeout
  /** P2：表单字段权限 */
  formPerms?: FormPerms
  /** P3：节点事件 */
  events?: NodeEvent[]
}

/** 流程级配置（Process） */
export interface FlowConfig {
  operations: {
    terminate: boolean
    retrieve: boolean
    urge: boolean
    cancel: boolean
  }
  start: {
    /** 启动权限（空 = 不限） */
    scope: OrgRef[]
    mobileStart: boolean
  }
  /** 流程变量 */
  variables?: FlowVariable[]
}

/** 全部可配按钮操作（顺序即展示/执行顺序；值与共享 AllowedOp 对齐） */
export const ALLOWED_OPS: { value: string; label: string }[] = [
  { value: "approve", label: "同意 / 办理" },
  { value: "reject", label: "驳回" },
  { value: "transfer", label: "转办" },
  { value: "delegate", label: "委派" },
  { value: "addSign", label: "加签" },
  { value: "counterSign", label: "会签" },
  { value: "assist", label: "协办" },
  { value: "retrieve", label: "撤回" },
  { value: "print", label: "打印" },
]

/** 节点默认配置 */
export function defaultNodeConfig(): NodeConfig {
  return {
    assigneeRules: [],
    multiMode: "ANY",
    emptyStrategy: "TO_ADMIN",
    ccUsers: [],
    allowedOps: ["approve", "reject", "transfer"],
    showApprovalRecord: true,
    handleOptions: defaultHandleOptions(),
  }
}

/** 流程默认配置 */
export function defaultFlowConfig(): FlowConfig {
  return {
    operations: { terminate: true, retrieve: false, urge: false, cancel: true },
    start: { scope: [], mobileStart: true },
    variables: [],
  }
}
