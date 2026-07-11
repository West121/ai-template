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
  /**
   * 循环体入口标记（loop 出边图契约，磐石裁定）：loop 恰两条出边——
   * loopBody=true 的是循环体入口（体内自然终止、不回连），另一条是循环结束后的续接。
   */
  loopBody?: boolean
  /**
   * 失败分支标记（onError=BRANCH 图契约）：动作节点选 BRANCH 时恰两条出边——
   * errorBranch=true 的是失败支，另一条是成功支。
   */
  errorBranch?: boolean
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
  | "wait"
  | "notify"
  | "startApproval"
  | "dataMap"
  | "subFlow"
  | "respond"
  | "dingtalkBot"
  | "feishuBot"
  | "dbQuery"
  | "llm"
  | "agent"
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

/* ---- 批3（§9）：AI Agent / Wait 挂起 / Webhook 同步响应 ---- */

export interface AgentToolParam {
  name: string
  /** JSON Schema 基础类型：string/number/boolean 等 */
  type: string
  description?: string
  required?: boolean
}

/** Agent 工具：LLM function-calling 声明 + 实现（HTTP 模板可用 {{args.xxx}} / SCRIPT 绑定 args） */
export interface AgentTool {
  name: string
  description: string
  params: AgentToolParam[]
  impl:
    | { kind: "HTTP"; method: HttpConfig["method"]; url: string; headers?: string; body?: string }
    | { kind: "SCRIPT"; script: ScriptConfig }
}

/** AI Agent（§9.1）：OpenAI function-calling 循环——LLM 决策 → 执行工具 → 回填 → 迭代至无 tool_calls 或 maxSteps */
export interface AgentConfig extends ActionCommon {
  credentialId?: number
  model?: string
  systemPrompt?: string
  userPrompt: string
  tools: AgentTool[]
  /** 默认 8，上限 15（护栏） */
  maxSteps?: number
  /** 整体超时，默认 120s */
  timeoutMs?: number
  outputMode: "TEXT" | "JSON"
  saveAs?: string
}

/** Wait for Webhook（§9.2）：执行到此 exec 置 WAITING 挂起，POST /api/orch/resume/{resumeToken} 恢复 */
export interface WaitConfig {
  /** 挂起超时，默认 24h；超时 → FAILED 或走 onError */
  timeoutMs?: number
  /** 回调 body 存入的变量名 */
  saveAs?: string
  /** 超时策略（复用 onError 语义） */
  onError?: ActionCommon["onError"]
}

/** Webhook 同步响应（§9.4）：仅 Webhook 触发时作为同步 HTTP 响应；其它触发等价 dataMap 存 body */
export interface RespondConfig {
  /** HTTP 状态码，默认 200 */
  status?: number
  /** 响应体模板 */
  body: string
  /** 默认 application/json */
  contentType?: string
}

/* ---- 批4（§9.5）：连接器 ---- */

/** 钉钉/飞书机器人 webhook 消息（共用形状；secret=加签密钥，钉钉必用、飞书可选） */
export interface BotConfig extends ActionCommon {
  /** 机器人 webhook 地址 */
  url: string
  /** 加签密钥（可选；服务端计算签名，不落日志） */
  secret?: string
  msgType: "text" | "markdown"
  /** markdown 标题（钉钉 markdown 必填） */
  title?: string
  /** 消息内容模板（{{...}} 插值） */
  content: string
}

/** JDBC 只读查询（§9.5）：select-only 硬校验 + 行数上限 1000 + 超时；受信门槛同脚本 */
export interface DbQueryConfig extends ActionCommon {
  /** 外部 JDBC 凭据 id；空 = 本应用库 */
  credentialId?: number
  /** SELECT 语句（模板插值；非 select 服务端硬拒） */
  sql: string
  /** 行数上限，默认/封顶 1000 */
  maxRows?: number
  timeoutMs?: number
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
  | WaitConfig
  | NotifyConfig
  | StartApprovalConfig
  | DataMapConfig
  | SubFlowConfig
  | RespondConfig
  | BotConfig
  | DbQueryConfig
  | LlmConfig
  | AgentConfig
  | EndConfig

/* ============================ 校验 ============================ */

/** 动作类节点（带 ActionCommon 重试/失败策略；BRANCH 出边契约适用。wait 的 onError=超时策略，同样适用） */
export const ACTION_TYPES: ReadonlySet<OrchNodeType> = new Set<OrchNodeType>([
  "http",
  "script",
  "notify",
  "startApproval",
  "dataMap",
  "subFlow",
  "dingtalkBot",
  "feishuBot",
  "dbQuery",
  "llm",
  "agent",
  "wait",
])

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
    if (n.type === "loop") {
      if (!(n.config as LoopConfig).collection?.trim()) {
        issues.push({ level: "error", message: `循环节点「${n.name}」缺少集合表达式`, nodeId: n.id })
      }
      // loop 图契约：恰两条出边，恰一条 loopBody（循环体入口），另一条为循环结束续接
      const outs = edges.filter((e) => e.source === n.id)
      const bodyCount = outs.filter((e) => e.loopBody).length
      if (outs.length !== 2) {
        issues.push({ level: "error", message: `循环节点「${n.name}」须恰有 2 条出边（循环体入口 + 循环后续接），当前 ${outs.length} 条`, nodeId: n.id })
      } else if (bodyCount !== 1) {
        issues.push({ level: "error", message: `循环节点「${n.name}」的出边须恰有 1 条标记为「循环体」，当前 ${bodyCount} 条`, nodeId: n.id })
      }
    }
    if (n.type === "delay") {
      const ms = (n.config as DelayConfig).ms
      if (!ms || ms <= 0) issues.push({ level: "error", message: `延时节点「${n.name}」需要正的毫秒数`, nodeId: n.id })
      else if (ms > 300_000) issues.push({ level: "error", message: `延时节点「${n.name}」超过 5 分钟上限（长等待请用审批流）`, nodeId: n.id })
    }
    if (n.type === "agent") {
      const cfg = n.config as AgentConfig
      if (!cfg.userPrompt?.trim()) issues.push({ level: "error", message: `Agent 节点「${n.name}」缺少用户提示词`, nodeId: n.id })
      if (cfg.credentialId == null) issues.push({ level: "warning", message: `Agent 节点「${n.name}」未选择凭据`, nodeId: n.id })
      if ((cfg.maxSteps ?? 8) > 15) issues.push({ level: "error", message: `Agent 节点「${n.name}」maxSteps 超过上限 15`, nodeId: n.id })
      cfg.tools.forEach((t, i) => {
        if (!t.name.trim()) issues.push({ level: "error", message: `Agent 节点「${n.name}」第 ${i + 1} 个工具缺少名称`, nodeId: n.id })
        if (t.impl.kind === "HTTP" && !t.impl.url.trim()) {
          issues.push({ level: "error", message: `Agent 节点「${n.name}」工具「${t.name || i + 1}」缺少 HTTP URL`, nodeId: n.id })
        }
      })
    }
    if (n.type === "respond") {
      if (!(n.config as RespondConfig).body?.trim()) {
        issues.push({ level: "warning", message: `响应节点「${n.name}」响应体为空`, nodeId: n.id })
      }
      const trigger = nodes.find((x) => x.type === "trigger")
      if (trigger && (trigger.config as TriggerConfig).triggerType !== "WEBHOOK") {
        issues.push({ level: "warning", message: `响应节点「${n.name}」仅 Webhook 触发时作同步响应，当前触发方式下等价于数据映射`, nodeId: n.id })
      }
    }
    if (n.type === "dingtalkBot" || n.type === "feishuBot") {
      const cfg = n.config as BotConfig
      if (!cfg.url?.trim()) issues.push({ level: "error", message: `机器人节点「${n.name}」缺少 webhook 地址`, nodeId: n.id })
      if (cfg.msgType === "markdown" && n.type === "dingtalkBot" && !cfg.title?.trim()) {
        issues.push({ level: "error", message: `钉钉机器人「${n.name}」markdown 消息必须填标题`, nodeId: n.id })
      }
    }
    if (n.type === "dbQuery") {
      const cfg = n.config as DbQueryConfig
      const sql = cfg.sql?.trim() ?? ""
      if (!sql) issues.push({ level: "error", message: `数据库查询「${n.name}」缺少 SQL`, nodeId: n.id })
      else if (!/^(select|with)\b/i.test(sql)) {
        issues.push({ level: "error", message: `数据库查询「${n.name}」仅允许只读 SELECT（服务端硬校验）`, nodeId: n.id })
      }
      if ((cfg.maxRows ?? 1000) > 1000) issues.push({ level: "error", message: `数据库查询「${n.name}」行数上限不得超过 1000`, nodeId: n.id })
    }
    // onError=BRANCH 图契约：动作节点恰 1 成功 + 1 失败出边；非 BRANCH 保持单出边
    if (ACTION_TYPES.has(n.type)) {
      const outs = edges.filter((e) => e.source === n.id)
      const errCount = outs.filter((e) => e.errorBranch).length
      const onError = (n.config as ActionCommon).onError
      if (onError === "BRANCH") {
        if (outs.length !== 2 || errCount !== 1) {
          issues.push({
            level: "error",
            message: `节点「${n.name}」失败策略为 BRANCH：须恰有 2 条出边且恰 1 条标记「失败分支」（当前 ${outs.length} 条出边 / ${errCount} 条失败支）`,
            nodeId: n.id,
          })
        }
      } else {
        if (outs.length > 1) {
          issues.push({ level: "error", message: `节点「${n.name}」未启用 BRANCH 失败策略，只能有 1 条出边（当前 ${outs.length} 条）`, nodeId: n.id })
        } else if (errCount > 0) {
          issues.push({ level: "warning", message: `节点「${n.name}」出边标了「失败分支」但失败策略不是 BRANCH（标记不生效）`, nodeId: n.id })
        }
      }
    }
  }

  // wait 不得在 parallel 开叉区 / loop 体内（对齐后端本期限制；前端即时反馈，后端权威）
  const waitNodes = nodes.filter((n) => n.type === "wait")
  if (waitNodes.length > 0) {
    const adjF = new Map<string, string[]>()
    for (const e of edges) adjF.set(e.source, [...(adjF.get(e.source) ?? []), e.target])
    const collect = (start: string, stopAt: Set<string> | null): Set<string> => {
      const seen = new Set<string>()
      const queue = [start]
      while (queue.length) {
        const id = queue.shift()!
        if (seen.has(id)) continue
        seen.add(id)
        if (stopAt?.has(id)) continue
        queue.push(...(adjF.get(id) ?? []))
      }
      return seen
    }
    const forbidden = new Set<string>()
    // loop 体：loopBody 边目标可达的全部节点
    for (const e of edges) {
      if (e.loopBody) for (const id of collect(e.target, null)) forbidden.add(id)
    }
    // parallel 开叉区：OPEN 出边目标可达、遇 JOIN 截止
    const joinIds = new Set(
      nodes.filter((x) => x.type === "parallel" && (x.config as ParallelConfig).mode === "JOIN").map((x) => x.id),
    )
    for (const p of nodes) {
      if (p.type !== "parallel" || (p.config as ParallelConfig).mode !== "OPEN") continue
      for (const e of edges.filter((x) => x.source === p.id)) {
        for (const id of collect(e.target, joinIds)) forbidden.add(id)
      }
    }
    for (const w of waitNodes) {
      if (forbidden.has(w.id)) {
        issues.push({ level: "error", message: `挂起节点「${w.name}」不得位于并行开叉区或循环体内（本期限制）`, nodeId: w.id })
      }
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
    case "wait":
      return { timeoutMs: 86_400_000 }
    case "respond":
      return { status: 200, body: '{"ok": true}', contentType: "application/json" }
    case "dingtalkBot":
    case "feishuBot":
      return { url: "", msgType: "text", content: "" }
    case "dbQuery":
      return { sql: "", maxRows: 1000, timeoutMs: 10_000 }
    case "llm":
      return { userPrompt: "", outputMode: "TEXT", timeoutMs: 60_000 }
    case "agent":
      return { userPrompt: "", tools: [], maxSteps: 8, timeoutMs: 120_000, outputMode: "TEXT" }
    case "end":
      return {}
  }
}
