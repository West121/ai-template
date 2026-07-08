/**
 * OA BPMN moddle 扩展（命名空间 http://oa/bpmn，前缀 oa）
 *
 * 为什么：bpmn-js 只认识标准 BPMN 元素，业务属性（处理人/多人模式/空值策略/按钮白名单…）
 * 无处安放。定义 oa moddle 扩展后，可把这些属性以 `oa:nodeConfig` / `oa:flowConfig`
 * 写进 UserTask / Process 的 `<bpmn:extensionElements>`，随 `saveXML()` 一并持久化，
 * 加载时再反序列化回属性面板 —— 替换旧版「演示态、保存即丢」的前端 Map 存储。
 *
 * 存储策略：标量（多人模式/空值策略/审批记录开关）作为可读属性直接落在 XML 上；
 * 嵌套结构（处理人 OrgRef[]、按钮白名单、办理选项）整体以 JSON 存入元素文本 body，
 * 反序列化时以 body JSON 为准（属性仅为 XML 可读性冗余）。
 */

/** moddle 扩展描述符：传入 Modeler 的 moddleExtensions[{ oa }] */
export const oaModdleDescriptor = {
  name: "OA",
  uri: "http://oa/bpmn",
  prefix: "oa",
  xml: { tagAlias: "lowerCase" },
  associations: [],
  types: [
    {
      /** 挂在 UserTask 的 extensionElements 下 */
      name: "NodeConfig",
      superClass: ["Element"],
      properties: [
        { name: "multiMode", type: "String", isAttr: true },
        { name: "emptyStrategy", type: "String", isAttr: true },
        { name: "showApprovalRecord", type: "Boolean", isAttr: true },
        // 完整配置（含处理人 / 抄送 / 按钮白名单 / 办理选项）以 JSON 存文本 body
        { name: "value", type: "String", isBody: true },
      ],
    },
    {
      /** 挂在 Process 的 extensionElements 下 */
      name: "FlowConfig",
      superClass: ["Element"],
      properties: [{ name: "value", type: "String", isBody: true }],
    },
  ],
} as const

export const OA_NS = "http://oa/bpmn"

/* ---------- TS 侧配置契约（对齐 docs/flow-designer-v2.md P1 数据契约 nodeConfig / flowConfig） ---------- */

import type { OrgRef } from "@/components/org-picker"
import type {
  AuditMenu,
  FormPerms,
  HandleOptions,
  NodeEvent,
  NodeTimeout,
} from "../../types"
import type { FlowVariable } from "../../shared/config"
import { defaultHandleOptions } from "../../shared/config"

/** 多人办理模式 */
export type MultiMode = "and" | "or" | "sequence"
/** 处理人为空时的兜底策略 */
export type EmptyStrategy = "skip" | "admin" | "initiator" | "toManager"

/**
 * 节点级配置（UserTask）。整体以 JSON 存入 oa:NodeConfig 文本 body，随 saveXML 持久化。
 * P2/P3 字段沿用共享契约类型（../types），与仿钉钉设计器一致，后端按同一契约读取。
 */
export interface NodeConfig {
  /** 处理人规则：用户 / 部门 / 角色 混合引用 */
  assigneeRules: OrgRef[]
  /** 多人模式：会签(and) / 或签(or) / 依次(sequence) */
  multiMode: MultiMode
  /** 空值策略 */
  emptyStrategy: EmptyStrategy
  /** 抄送人（抄送节点用） */
  ccUsers: OrgRef[]
  /** 按钮操作白名单（对应后端 allowedOps） */
  allowedOps: string[]
  /** 是否展示审批记录 */
  showApprovalRecord: boolean
  /** 办理选项（P2 全套，共享契约） */
  handleOptions: HandleOptions
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

/** 全部可配按钮操作（顺序即展示/执行顺序） */
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

export const MULTI_MODES: { value: MultiMode; label: string }[] = [
  { value: "and", label: "会签（全部通过）" },
  { value: "or", label: "或签（一人通过）" },
  { value: "sequence", label: "依次审批" },
]

export const EMPTY_STRATEGIES: { value: EmptyStrategy; label: string }[] = [
  { value: "skip", label: "自动跳过" },
  { value: "admin", label: "转交管理员" },
  { value: "initiator", label: "转交发起人" },
  { value: "toManager", label: "转交上级主管" },
]

/** 节点默认配置 */
export function defaultNodeConfig(): NodeConfig {
  return {
    assigneeRules: [],
    multiMode: "or",
    emptyStrategy: "admin",
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
