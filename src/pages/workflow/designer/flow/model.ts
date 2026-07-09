/**
 * 下一代流程设计器 · 归一化流程模型 `ProcessModel`（真相源 = Option B）。
 *
 * 定位：统一取代仿钉钉 `dingtalk/model.ts` + `designerJson` 与 bpmn `oa/serde.ts` 两套模型。
 * 结构上与 BPMN 2.0 元素 **1:1 图（graph）映射**：扁平 `nodes[]` + 显式 `edges[]`，
 * 节点内联坐标/尺寸、边内联 waypoints/默认标记/结构化条件，服务端据此转 `BpmnModel` 并补 BPMN DI。
 *
 * 与旧结构的根本差异（迁移要点，详见 docs/design/next-gen-workflow-and-formula.md 附录 A）：
 *  - 旧钉钉 `designerJson` 是「嵌套线性树」：`{ nodes: [...] }`，分支用 `branches[].steps[]` 递归，
 *    没有 startEvent/endEvent、没有网关节点、没有边、没有坐标——网关/连线/布局全由后端
 *    `JsonToBpmnConverter` 合成。
 *  - 本模型是「显式图」：startEvent/endEvent/网关都是一等节点，连线是显式 edge，坐标由前端产出。
 *    因此本模型是旧 designerJson 的**超集**（能表达旧全部 + 并行/包容网关成对 fork-join、
 *    定时边界事件、嵌套子流程、任意图形拓扑）。
 *
 * 跨端红线：
 *  - 节点审批域属性复用 `WfNodeProps`（import，绝不重定义）；共享 PropertyPanel 原样复用。
 *  - 边的**简单结构化条件**用 `BranchCondition`，服务端 `ConditionCompiler` 编译为 UEL——
 *    保持与现有前端 serde / 后端 ConditionCompiler 的字节级互镜像；高级公式走 `expression` 逃生口。
 *
 * 禁止 any；类型导入一律 `import type`（verbatimModuleSyntax）。
 */
import type { BranchCondition, WfNodeProps } from "../types"
import type { FlowConfig } from "../shared/config"

/* ============================================================
 * 顶层结构
 * ============================================================ */

/** 画布坐标点（BPMN DI 单位，左上原点，向右下为正） */
export interface Point {
  x: number
  y: number
}

/** 节点尺寸（省略时后端按元素类型给默认：事件 30×30 / 网关 40×40 / 任务 100×60） */
export interface Size {
  w: number
  h: number
}

/**
 * 归一化流程模型：前端画布产出、后端消费转 BpmnModel、可经 Flowable BpmnXMLConverter 往返 .bpmn。
 */
export interface ProcessModel {
  /** 契约版本号，用于后续演进的迁移判别（当前恒为 1） */
  schemaVersion: 1
  /** 流程定义编码（作为 BPMN process id，服务端会 sanitize） */
  key: string
  /** 流程名（BPMN process name） */
  name: string
  /** 定义版本（可空，随 ProcessDef 版本） */
  version?: number
  /** 绑定表单 key（formCode:version），写入各 userTask 的 formKey */
  formKey?: string
  /** 流程级配置（操作开关/启动权限/流程变量）——写入 process 扩展元素 oa:flowConfig，复用现有类型 */
  flowConfig?: FlowConfig
  /** 流程节点（映射 BPMN FlowNode / Event / Gateway / Activity） */
  nodes: FlowNode[]
  /** 连线（映射 BPMN sequenceFlow；边界事件的附着关系不走 edge，见 TimerBoundaryNode.attachedTo） */
  edges: SequenceFlow[]
}

/* ============================================================
 * 节点类型
 * ============================================================ */

/**
 * 节点类型判别键。BPMN 规范元素 + OA 扩展节点（cc/ai/webhook，均映射为带 delegate 的 serviceTask）。
 *
 * - `timerCatch`  = 流程线上的中间捕获定时事件（intermediateCatchEvent + timerEventDefinition），
 *                   等价旧钉钉 `timer` 节点。
 * - `timerBoundary` = 附着在任务上的边界定时事件（boundaryEvent + timerEventDefinition），旧模型无、本模型新增。
 * - OA 语义 serviceTask（自动通过/自动拒绝/触发器）统一收敛到 `serviceTask`，用 `service.impl` 判别，见 ServiceTaskConfig。
 */
export type FlowNodeType =
  | "startEvent"
  | "endEvent"
  | "userTask"
  | "serviceTask"
  | "exclusiveGateway"
  | "parallelGateway"
  | "inclusiveGateway"
  | "callActivity"
  | "subProcess"
  | "timerCatch"
  | "timerBoundary"
  | "cc"
  | "ai"
  | "webhook"

/** 所有节点共有字段 */
export interface FlowNodeBase {
  id: string
  name: string
  /** 画布坐标（左上角），服务端据此生成 BPMNShape */
  position: Point
  /** 尺寸；省略时后端按类型给默认 */
  size?: Size
  /**
   * 审批域属性（assigneeRules / multiMode / voteConfig / emptyStrategy / ccUsers / formPerms /
   * timeout / events / handleOptions …）——复用现有 WfNodeProps，共享 PropertyPanel 原样消费。
   * 注意：**分支条件不再放这里**（旧钉钉挂在 nodeProps[branchId].condition），改由 edge.condition 承载。
   */
  props?: WfNodeProps
}

/** 起始事件（BPMN startEvent）：全流程唯一入口，无入边 */
export interface StartEventNode extends FlowNodeBase {
  type: "startEvent"
}

/** 结束事件（BPMN endEvent）：无出边；terminate=true 时带 terminateEventDefinition（整实例终止，等价旧 autoReject 尾部） */
export interface EndEventNode extends FlowNodeBase {
  type: "endEvent"
  terminate?: boolean
}

/** 用户任务（BPMN userTask）：审批节点，审批人/多实例/票签/超时/表单权限等全在 props */
export interface UserTaskNode extends FlowNodeBase {
  type: "userTask"
  /** 覆盖流程级 formKey（一般继承 ProcessModel.formKey，可空） */
  formKey?: string
}

/**
 * 服务任务（BPMN serviceTask，delegateExpression）。OA 语义由 service.impl 判别，
 * 覆盖旧钉钉 autoApprove / autoReject / trigger 三类 + 通用 delegate。
 */
export interface ServiceTaskNode extends FlowNodeBase {
  type: "serviceTask"
  service: ServiceTaskConfig
}

/** 排它网关（BPMN exclusiveGateway）：命中优先级最高的一条出边；默认出边由 edge.isDefault 标记 */
export interface ExclusiveGatewayNode extends FlowNodeBase {
  type: "exclusiveGateway"
}

/** 并行网关（BPMN parallelGateway）：fork 无条件全激活 / join 全部到达汇聚；出边不带条件 */
export interface ParallelGatewayNode extends FlowNodeBase {
  type: "parallelGateway"
}

/** 包容网关（BPMN inclusiveGateway）：满足的多条出边都走 + 默认出边（edge.isDefault） */
export interface InclusiveGatewayNode extends FlowNodeBase {
  type: "inclusiveGateway"
}

/** 调用活动（BPMN callActivity）：调用已部署的子流程 defCode（同步阻塞 / 异步旁路） */
export interface CallActivityNode extends FlowNodeBase {
  type: "callActivity"
  callActivity: CallActivityConfig
}

/**
 * 嵌入式子流程（BPMN subProcess）：内含独立的一段图（自带 startEvent/endEvent）。
 * 旧模型无此能力，本模型新增（后端 N-B-01 需支持递归展开 children 到 BPMN SubProcess 内联元素）。
 */
export interface SubProcessNode extends FlowNodeBase {
  type: "subProcess"
  children: {
    nodes: FlowNode[]
    edges: SequenceFlow[]
  }
}

/** 中间捕获定时事件（BPMN intermediateCatchEvent + timerEventDefinition）：到点进入下一步。等价旧钉钉 timer */
export interface TimerCatchNode extends FlowNodeBase {
  type: "timerCatch"
  timer: TimerConfig
}

/**
 * 边界定时事件（BPMN boundaryEvent + timerEventDefinition），附着在某个任务上（本模型新增）。
 * attachedTo 指向宿主节点 id（不走 edge）；cancelActivity=true 为中断型（到点取消宿主任务走出边），
 * false 为非中断型（宿主继续，同时并行走出边，如「超时提醒但不打断」）。
 */
export interface TimerBoundaryNode extends FlowNodeBase {
  type: "timerBoundary"
  timer: TimerConfig
  /** 宿主活动节点 id（userTask / callActivity / subProcess …） */
  attachedTo: string
  /** 是否中断宿主活动，默认 true（中断型） */
  cancelActivity?: boolean
}

/** 抄送节点（OA 扩展 → serviceTask delegateExpression ${wfCcDelegate}）；抄送人取 props.ccUsers */
export interface CcNode extends FlowNodeBase {
  type: "cc"
}

/** AI 审批节点（OA 扩展 → serviceTask delegateExpression ${wfAiApprovalDelegate}） */
export interface AiNode extends FlowNodeBase {
  type: "ai"
  ai: AiConfig
}

/** Webhook 节点（OA 扩展 → serviceTask delegateExpression ${wfWebhookDelegate}） */
export interface WebhookNode extends FlowNodeBase {
  type: "webhook"
  webhook: WebhookConfig
}

/** 全体节点判别联合 */
export type FlowNode =
  | StartEventNode
  | EndEventNode
  | UserTaskNode
  | ServiceTaskNode
  | ExclusiveGatewayNode
  | ParallelGatewayNode
  | InclusiveGatewayNode
  | CallActivityNode
  | SubProcessNode
  | TimerCatchNode
  | TimerBoundaryNode
  | CcNode
  | AiNode
  | WebhookNode

/* ============================================================
 * 连线（sequenceFlow）
 * ============================================================ */

/**
 * 连线：映射 BPMN sequenceFlow，1:1 一条边一个元素。
 *
 * 条件二选一（互斥优先级：expression > condition）：
 *  - `condition`：简单结构化条件，服务端 `ConditionCompiler` 编译为 UEL（保持跨端字节兼容，Flowable 原生高性能）。
 *  - `expression`：高级公式/表达式逃生口（Tier 1 引擎路径，见设计文档 §3.2），原样作为条件表达式串下发。
 *  - 两者皆空且 isDefault!=true：无条件顺序边（顺序流 / 并行网关出边）。
 */
export interface SequenceFlow {
  id: string
  /** 源节点 id */
  source: string
  /** 目标节点 id */
  target: string
  /** 连线标签（可空，一般展示条件摘要） */
  name?: string
  /** 拐点坐标序列（不含端点吸附点亦可，服务端可据端点补全），服务端生成 BPMNEdge */
  waypoints?: Point[]
  /** 默认分支：source 为网关时，其他出边都不满足则走此边。服务端据此设置 gateway.default */
  isDefault?: boolean
  /** 简单结构化条件（编译 UEL，跨端兼容 ConditionCompiler） */
  condition?: BranchCondition
  /** 高级公式条件（Tier 1 引擎，原样下发为条件表达式）；与 condition 互斥，优先级更高 */
  expression?: string
}

/* ============================================================
 * 节点类型专属配置（审批域以外的节点数据；审批域一律走 WfNodeProps）
 * ============================================================ */

/**
 * 服务任务实现判别：
 *  - autoApprove：${wfAutoDecide} autoDecision=APPROVE，到达自动通过并放行（非终止）。
 *  - autoReject ：${wfAutoDecide} autoDecision=REJECT，自动驳回（通常尾接 terminate endEvent 终止实例）。
 *  - trigger    ：${wfTriggerDelegate}，执行注册触发器或 WEBHOOK；triggerType=TIMER 时前置定时。
 *  - delegate   ：通用 delegateExpression（受信 bean 名 / 未来脚本任务 scriptTask 的过渡承载）。
 */
export type ServiceTaskConfig =
  | { impl: "autoApprove" }
  | { impl: "autoReject" }
  | {
      impl: "trigger"
      triggerType: "IMMEDIATE" | "TIMER"
      /** 已注册触发器 bean 名（与 webhookUrl 二选一） */
      handler?: string
      /** WEBHOOK 触发地址（与 handler 二选一） */
      webhookUrl?: string
      /** triggerType=TIMER 时的定时表达式（ISO8601 duration / 日期） */
      timer?: string
    }
  | {
      impl: "delegate"
      /** delegateExpression，如 ${someBean} */
      delegateExpression: string
    }

/** 调用活动配置：子流程 defCode + 同异步 + 参数映射（子变量 ← 父字段） */
export interface CallActivityConfig {
  /** 子流程定义编码（BPMN calledElement） */
  calledElement: string
  /** true=异步旁路（并行网关分叉，不阻塞主流程）；false=同步（阻塞等待子流程结束） */
  async: boolean
  /** 是否继承父流程变量，默认 true */
  inheritVariables?: boolean
  /** 参数映射：{ 子流程变量名 child ← 父流程表单字段/变量 parent } */
  paramMap: { child: string; parent: string }[]
}

/** 定时配置（timerCatch / timerBoundary 共用）：mode=cycle 为本模型新增（周期定时，如非中断边界重复提醒） */
export interface TimerConfig {
  /** duration=相对时长(ISO8601 如 PT1H/P1D) / date=绝对日期时间 / cycle=循环(ISO8601 如 R3/PT10M) */
  mode: "duration" | "date" | "cycle"
  value: string
}

/** AI 审批配置 */
export interface AiConfig {
  /** 模型标识（无 key 时后端降级规则模拟） */
  model: string
  /** 系统提示词 */
  systemPrompt: string
  /** 注入 AI 上下文的表单字段 key 列表 */
  formContext: string[]
  /** 输出映射：AI 结果写入的流程变量名 */
  outputMap: {
    /** 决策变量（值域 approve|reject|route） */
    decision: string
    /** 审批意见变量 */
    comment: string
    /** 路由目标变量（decision=route 时生效） */
    route?: string
  }
}

/** Webhook 配置 */
export interface WebhookConfig {
  /** 回调地址 */
  url: string
}

/* ============================================================
 * 类型守卫（画布/校验/序列化统一遍历用）
 * ============================================================ */

/** 网关节点（三类网关统一判定） */
export function isGatewayNode(
  node: FlowNode,
): node is ExclusiveGatewayNode | ParallelGatewayNode | InclusiveGatewayNode {
  return (
    node.type === "exclusiveGateway" || node.type === "parallelGateway" || node.type === "inclusiveGateway"
  )
}

/** 事件节点（起止/定时事件统一判定） */
export function isEventNode(
  node: FlowNode,
): node is StartEventNode | EndEventNode | TimerCatchNode | TimerBoundaryNode {
  return (
    node.type === "startEvent" ||
    node.type === "endEvent" ||
    node.type === "timerCatch" ||
    node.type === "timerBoundary"
  )
}

/** 可作为定时边界宿主的活动节点（userTask/serviceTask/callActivity/subProcess/cc/ai/webhook） */
export function isActivityNode(node: FlowNode): boolean {
  return (
    node.type === "userTask" ||
    node.type === "serviceTask" ||
    node.type === "callActivity" ||
    node.type === "subProcess" ||
    node.type === "cc" ||
    node.type === "ai" ||
    node.type === "webhook"
  )
}
