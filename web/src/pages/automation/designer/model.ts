/**
 * 自动化逻辑编排 · 图模型 OrchModel（前后端同一契约，docs/design/orchestration-design.md §2）。
 *
 * 独立于审批流 ProcessModel：编排是无人值守的动作图（LiteFlow 编译执行），节点带类型化 config，
 * 边可带结构化条件（复用 BranchCondition 类型）或 Aviator 表达式；模板插值统一 `{{expr}}`
 * （后端 OrchTemplate 求值，前端只做提示与插入）。禁 any；类型导入 import type。
 */
import type { BranchCondition } from "@/pages/workflow/designer/types"
import type { ScriptConfig } from "@/pages/workflow/designer/flow/model"
import type { OrgRef } from "@/components/org-picker"

/* ============================ 顶层 ============================ */

export interface OrchModel {
  schemaVersion: 1
  /** 编排编码（唯一） */
  key: string
  name: string
  nodes: OrchNode[]
  edges: OrchEdge[]
}

export interface OrchEdge {
  id: string
  source: string
  target: string
  /** 结构化条件（condition 节点出边；复用 BranchCondition，field 写上下文表达式如 outputs.n1.status） */
  condition?: BranchCondition
  /** Aviator 表达式逃生口（与 condition 二选一，优先） */
  expression?: string
  /** 默认分支（其他条件都不满足时走） */
  isDefault?: boolean
}

/* ============================ 节点 ============================ */

export type OrchNodeType =
  | "trigger"
  | "http"
  | "script"
  | "condition"
  | "parallel"
  | "loop"
  | "delay"
  | "notify"
  | "startApproval"
  | "dataMap"
  | "subFlow"
  | "llm"
  | "end"

export interface OrchNodeBase {
  id: string
  type: OrchNodeType
  name: string
  position: { x: number; y: number }
  config: OrchNodeConfig
}

export type OrchNode = OrchNodeBase

/** 动作类节点通用字段（http/script/notify/startApproval/dataMap/subFlow/llm） */
export interface ActionCommon {
  /** backoff=指数退避（§8 P0） */
  retry?: { times: number; intervalMs: number; backoff?: boolean }
  onError?: "ABORT" | "CONTINUE" | "BRANCH"
}

export type TriggerType = "MANUAL" | "CRON" | "EVENT" | "WEBHOOK"

export interface TriggerConfig {
  triggerType: TriggerType
  /** CRON：表达式 */
  cron?: string
  /** EVENT：事件订阅 */
  event?: { source: "WF" | "GONGWEN"; type: string; defCode?: string }
  /** WEBHOOK：token 由后端生成（只读展示） */
  webhookToken?: string
}

export interface HttpConfig extends ActionCommon {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  url: string
  /** JSON 文本（模板插值） */
  headers?: string
  /** JSON / 文本（模板插值） */
  body?: string
  timeoutMs?: number
  /** 通用凭据（HTTP_BEARER/HTTP_BASIC/HTTP_HEADER，执行时按类型注入认证头；§8 P0） */
  credentialId?: number
  /** 响应解析：JSON（默认）/ TEXT */
  responseType?: "JSON" | "TEXT"
  /** 输出变量名（outputs[nodeId] 恒有；saveAs 另存 vars） */
  saveAs?: string
}

export interface ScriptNodeConfig extends ActionCommon {
  script: ScriptConfig
}

/** condition：无 config，分支条件在出边上 */
export type ConditionConfig = Record<string, never>

export interface ParallelConfig {
  /** OPEN=开叉 / JOIN=汇合（编译为 LiteFlow WHEN） */
  mode: "OPEN" | "JOIN"
}

export interface LoopConfig {
  /** 集合表达式，如 {{outputs.n1.body.list}} */
  collection: string
  itemVar: string
  /** 护栏，默认 1000 */
  maxIterations?: number
}

export interface DelayConfig {
  /** 延时毫秒（上限 5min） */
  ms: number
}

export interface NotifyConfig extends ActionCommon {
  recipients: OrgRef[]
  title: string
  content: string
}

export interface StartApprovalConfig extends ActionCommon {
  defCode: string
  /** 标题模板 */
  title?: string
  /** 表单映射：字段 ← 模板/表达式 */
  formData: { field: string; expr: string }[]
}

export interface DataMapConfig extends ActionCommon {
  assignments: { target: string; expr: string }[]
}

/** 子编排（n8n Execute Workflow；§8 P0）：调用另一条编排，深度护栏由后端把关（≤5 层） */
export interface SubFlowConfig extends ActionCommon {
  /** 目标编排编码 */
  flowCode: string
  /** 子编排 payload 映射（字段 ← 模板/表达式） */
  payload: { field: string; expr: string }[]
  /** true=等待子编排结束并取其结果入 outputs；false=触发即返回 */
  waitResult: boolean
}

export interface LlmConfig extends ActionCommon {
  /** 凭据 id（designer_json 不落明文 key） */
  credentialId?: number
  /** 覆盖凭据默认模型（可空） */
  model?: string
  systemPrompt?: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
  /** 默认 60s */
  timeoutMs?: number
  outputMode: "TEXT" | "JSON"
  saveAs?: string
}

export interface EndConfig {
  /** 可选：流水结果表达式 */
  output?: string
}

export type OrchNodeConfig =
  | TriggerConfig
  | HttpConfig
  | ScriptNodeConfig
  | ConditionConfig
  | ParallelConfig
  | LoopConfig
  | DelayConfig
  | NotifyConfig
  | StartApprovalConfig
  | DataMapConfig
  | SubFlowConfig
  | LlmConfig
  | EndConfig

/* ============================ 校验 ============================ */

export interface OrchIssue {
  level: "error" | "warning"
  message: string
  nodeId?: string
  edgeId?: string
}

/**
 * 模型级校验（保存/发布前）：
 * 单 trigger 且无入边；end 无出边；condition 出边应有默认支；无环（含 loop 节点的环放行为 warning）；
 * 孤立节点 warning。编译细节（EL 生成）由后端把关。
 */
export function validateOrchModel(model: OrchModel): OrchIssue[] {
  const issues: OrchIssue[] = []
  const { nodes, edges } = model

  const triggers = nodes.filter((n) => n.type === "trigger")
  if (triggers.length === 0) issues.push({ level: "error", message: "缺少触发节点（每条编排必须有且仅有一个）" })
  if (triggers.length > 1) {
    for (const t of triggers.slice(1)) {
      issues.push({ level: "error", message: `触发节点只能有一个（多余：${t.name}）`, nodeId: t.id })
    }
  }
  for (const t of triggers) {
    if (edges.some((e) => e.target === t.id)) {
      issues.push({ level: "error", message: `触发节点「${t.name}」不能有入边`, nodeId: t.id })
    }
    const cfg = t.config as TriggerConfig
    if (cfg.triggerType === "CRON" && !cfg.cron?.trim()) {
      issues.push({ level: "error", message: `触发节点「${t.name}」缺少 CRON 表达式`, nodeId: t.id })
    }
    if (cfg.triggerType === "EVENT" && !cfg.event?.type?.trim()) {
      issues.push({ level: "error", message: `触发节点「${t.name}」缺少事件类型`, nodeId: t.id })
    }
  }

  for (const n of nodes) {
    if (n.type === "end" && edges.some((e) => e.source === n.id)) {
      issues.push({ level: "error", message: `结束节点「${n.name}」不能有出边`, nodeId: n.id })
    }
    if (n.type === "condition") {
      const outs = edges.filter((e) => e.source === n.id)
      if (outs.length < 2) {
        issues.push({ level: "warning", message: `条件节点「${n.name}」出边少于 2 条`, nodeId: n.id })
      } else if (!outs.some((e) => e.isDefault)) {
        issues.push({ level: "warning", message: `条件节点「${n.name}」建议设一条默认分支`, nodeId: n.id })
      }
    }
    if (n.type === "llm") {
      const cfg = n.config as LlmConfig
      if (!cfg.userPrompt?.trim()) issues.push({ level: "error", message: `AI 节点「${n.name}」缺少用户提示词`, nodeId: n.id })
      if (cfg.credentialId == null) issues.push({ level: "warning", message: `AI 节点「${n.name}」未选择凭据`, nodeId: n.id })
    }
    if (n.type === "http" && !(n.config as HttpConfig).url?.trim()) {
      issues.push({ level: "error", message: `HTTP 节点「${n.name}」缺少 URL`, nodeId: n.id })
    }
    if (n.type === "subFlow" && !(n.config as SubFlowConfig).flowCode?.trim()) {
      issues.push({ level: "error", message: `子编排节点「${n.name}」未选择目标编排`, nodeId: n.id })
    }
    if (n.type === "loop" && !(n.config as LoopConfig).collection?.trim()) {
      issues.push({ level: "error", message: `循环节点「${n.name}」缺少集合表达式`, nodeId: n.id })
    }
    if (n.type === "delay") {
      const ms = (n.config as DelayConfig).ms
      if (!ms || ms <= 0) issues.push({ level: "error", message: `延时节点「${n.name}」需要正的毫秒数`, nodeId: n.id })
      else if (ms > 300_000) issues.push({ level: "error", message: `延时节点「${n.name}」超过 5 分钟上限（长等待请用审批流）`, nodeId: n.id })
    }
  }

  // 孤立节点（非 trigger 无入边）
  const targets = new Set(edges.map((e) => e.target))
  for (const n of nodes) {
    if (n.type !== "trigger" && !targets.has(n.id)) {
      issues.push({ level: "warning", message: `节点「${n.name}」没有入边（不可达）`, nodeId: n.id })
    }
  }

  // 环检测（DFS）；环上含 loop 节点降级 warning（遍历语义由 loop 承载）
  const adj = new Map<string, string[]>()
  for (const e of edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target])
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const cycles: string[][] = []
  const dfs = (id: string) => {
    state.set(id, 1)
    stack.push(id)
    for (const next of adj.get(id) ?? []) {
      const s = state.get(next) ?? 0
      if (s === 0) dfs(next)
      else if (s === 1) cycles.push(stack.slice(stack.indexOf(next)))
    }
    stack.pop()
    state.set(id, 2)
  }
  for (const n of nodes) if ((state.get(n.id) ?? 0) === 0) dfs(n.id)
  for (const cyc of cycles) {
    const hasLoop = cyc.some((id) => nodeById.get(id)?.type === "loop")
    const names = cyc.map((id) => nodeById.get(id)?.name ?? id).join(" → ")
    issues.push({
      level: hasLoop ? "warning" : "error",
      message: hasLoop ? `检测到含循环节点的回路（确认由 loop 承载遍历）：${names}` : `存在回路（编排必须无环）：${names}`,
      nodeId: cyc[0],
    })
  }

  return issues
}

/** 各类型缺省 config（palette 新增节点用） */
export function defaultConfig(type: OrchNodeType): OrchNodeConfig {
  switch (type) {
    case "trigger":
      return { triggerType: "MANUAL" }
    case "http":
      return { method: "GET", url: "", timeoutMs: 10_000 }
    case "script":
      return { script: { lang: "groovy", code: "" } }
    case "condition":
      return {}
    case "parallel":
      return { mode: "OPEN" }
    case "loop":
      return { collection: "", itemVar: "item", maxIterations: 1000 }
    case "delay":
      return { ms: 1000 }
    case "notify":
      return { recipients: [], title: "", content: "" }
    case "startApproval":
      return { defCode: "", formData: [] }
    case "dataMap":
      return { assignments: [{ target: "", expr: "" }] }
    case "subFlow":
      return { flowCode: "", payload: [], waitResult: true }
    case "llm":
      return { userPrompt: "", outputMode: "TEXT", timeoutMs: 60_000 }
    case "end":
      return {}
  }
}
