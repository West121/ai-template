/**
 * 工作流 P3（高级能力）前端类型 —— 交叉扩展，不修改 src/types/workflow.ts。
 *
 * 契约依据 docs/workflow-design.md「P3 实施规格」§P3-A~C。
 * 后端 P3 端点（/api/wf）并行开发中，未就绪端点前端优雅降级，不造假数据。
 *
 *  - 运行时端点：predict / resurrect / instances(bizTime) / wf/seals
 *  - 详情扩展：WfInstanceDetailP3（子流程入口 / 预测·唤醒可用性 / 已用章 / 业务时间 / 节点表单权限）
 */
import type { FieldPerm, WfInstanceDetail } from "./workflow"

/* ================= P3-C 实例详情扩展 ================= */

/** 子流程入口：主流程节点关联的子实例 */
export interface WfSubInstance {
  /** 父流程中触发子流程的节点 id */
  nodeId: string
  /** 子实例扩展表 id（详情跳转用） */
  subInstanceId: number
  title: string
  bizStatus: string
}

/** 已用电子章（节点盖章记录，用于详情/套打页叠加展示） */
export interface WfSeal {
  /** 盖章所在节点名 */
  nodeName: string
  /** 印章图 URL（后端直出，引用文件管理） */
  sealImageUrl: string
  /** 用章人 */
  userName: string
  /** 盖章时间（穿越时空场景为业务时间） */
  time?: string
}

/**
 * 详情 P3 增强：从 WfInstanceDetail 只读扩展。
 * 后端在 GET /api/wf/instances/{id} 响应中附带这些字段；缺省则各能力静默不展示。
 */
export interface WfInstanceDetailP3 extends WfInstanceDetail {
  /** 子流程入口（有值时可点击跳转子实例详情） */
  subInstances?: WfSubInstance[]
  /** 是否可发起流程预测（RUNNING 且有后续节点时后端置 true） */
  predictable?: boolean
  /** 是否可唤醒（已结束实例 + 管理员时后端置 true） */
  resurrectable?: boolean
  /** 已用电子章 */
  seals?: WfSeal[]
  /** 穿越时空业务时间（ISO 日期）：展示/套打用业务时间，引擎真实时间不动 */
  bizTime?: string
  /** 当前节点字段权限（透传给 FormRenderer 的 perms：HIDDEN/READ/EDIT） */
  nodeFormPerms?: Record<string, FieldPerm>
  /**
   * 绑定表单 key（formCode:version 或 CODE 表单 registry key）。
   * 后端下发；当其命中前端 registry（`isCodeForm(formKey)`）时，详情表单区改用 CODE 表单
   * 包裹层 `HostedForm` 渲染，`nodeFormPerms` 合成 `FieldPolicyMap` 套用（设计文档 2.4）。
   * 缺省或非 CODE → 走原 ONLINE FormRenderer 路径（现状不变）。
   */
  formKey?: string
}

/* ================= P3-A 运行时端点入参 / 返回 ================= */

/** 预测路径上的一个节点 */
export interface WfPredictNode {
  nodeId: string
  nodeName: string
  /** 节点类型（approval/cc/condition/subprocess/timer/trigger/ai/end 等，展示图标用） */
  type: string
  /** 预计审批人（静态试算，可能为空） */
  assignees?: { name: string }[]
}

/** POST instances/{id}/predict 返回：静态演算后续将经过节点 + 预计审批人 */
export interface WfPredictResult {
  path: WfPredictNode[]
  /** 演算说明（如分支按当前表单值命中、审批人试算局限等） */
  note?: string
}

/** POST instances/{id}/resurrect 唤醒（已结束实例按快照重建 + 定位节点重审） */
export interface WfResurrectInput {
  /** 唤醒后定位到的节点 id */
  nodeId: string
  comment?: string
}

/** POST instances 穿越时空补审：在发起入参上附业务时间（ISO 日期） */
export interface WfTimeTravelInput {
  defCode: string
  formData: Record<string, unknown>
  title?: string
  /** 业务时间：审批记录时间记为该日期，引擎真实时间不动 */
  bizTime: string
}

/* ================= 印章管理（GET/POST/DELETE wf/seals） ================= */

/** 电子章定义 */
export interface WfSealDef {
  id: number
  name: string
  /** 引用文件管理的印章图文件 id */
  imageFileId: number
  /** 印章图直出 URL（后端可选返回，便于预览） */
  imageUrl?: string
  enabled: boolean
  createdBy?: string
  createdAt?: string
}

/** POST wf/seals 新建电子章入参【wf:def:edit】 */
export interface WfSealInput {
  name: string
  imageFileId: number
  enabled: boolean
}
