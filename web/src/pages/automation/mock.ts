/**
 * 自动化编排 · API 层 + offline mock（契约 §3.6/§6/§8，前缀 /api/orch/*）。
 *
 * 与公文 gongwen/mock.ts 同一降级约定：offline 或 NetworkError → 内存 mock 顶住并回传 demo=true；
 * 真实 ApiError（403/400）照抛。mock 内置一条「webhook → http → condition → llm → notify」演示流
 * 与若干执行记录；测试运行在 mock 下本地模拟出带节点留痕的成功流水。
 */
import { api, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import type { OrchModel, TriggerType } from "./designer/model"

/* ============================ 类型（对齐 §3 表结构） ============================ */

export interface OrchFlow {
  id: number
  code: string
  name: string
  designerJson?: string
  triggerType: TriggerType
  /** WEBHOOK 触发的入站地址 token */
  webhookToken?: string
  enabled: boolean
  version?: number
  /** 错误工作流（整流失败时触发的编排 id；§8 P0） */
  errorFlowId?: number | null
  updatedAt?: string
  /** 最近一次执行（列表展示） */
  lastExec?: { status: OrchExecStatus; startedAt: string }
}

export type OrchExecStatus = "RUNNING" | "SUCCESS" | "FAILED" | "CANCELED"

export interface OrchExec {
  id: number
  flowId: number
  flowName?: string
  triggerKind: string
  status: OrchExecStatus
  startedAt: string
  endedAt?: string
  error?: string
  result?: string
  /** 详情才带 */
  payload?: string
  nodes?: OrchExecNode[]
}

export interface OrchExecNode {
  nodeId: string
  nodeName: string
  status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED"
  input?: string
  output?: string
  error?: string
  costMs?: number
  startedAt?: string
}

export type CredentialType = "LLM" | "HTTP_BEARER" | "HTTP_BASIC" | "HTTP_HEADER"

export interface OrchCredential {
  id: number
  name: string
  type: CredentialType
  baseUrl?: string
  /** LLM 默认模型 */
  model?: string
  /** 是否已配置密钥（key 只写不回显） */
  hasKey?: boolean
}

export interface OrchResult<T> {
  data: T
  demo: boolean
}

/* ============================ mock 数据 ============================ */

const DEMO_MODEL: OrchModel = {
  schemaVersion: 1,
  key: "doc_ai_notify",
  name: "公文签发 AI 摘要通报",
  nodes: [
    { id: "t1", type: "trigger", name: "Webhook 入站", position: { x: 260, y: 20 }, config: { triggerType: "WEBHOOK", webhookToken: "demo-hook-9f3a" } },
    {
      id: "h1", type: "http", name: "取公文详情", position: { x: 235, y: 140 },
      config: { method: "GET", url: "https://oa.internal/api/office/doc/{{payload.docId}}", timeoutMs: 10000, responseType: "JSON", saveAs: "doc", retry: { times: 3, intervalMs: 1000, backoff: true }, onError: "ABORT" },
    },
    { id: "c1", type: "condition", name: "是否正式公文", position: { x: 255, y: 265 }, config: {} },
    {
      id: "ai1", type: "llm", name: "AI 生成摘要", position: { x: 110, y: 385 },
      config: { credentialId: 1, model: "deepseek-chat", systemPrompt: "你是公文摘要助手，输出一段不超过120字的要点。", userPrompt: "请总结这份公文：{{outputs.h1.body.title}}\n{{outputs.h1.body.content}}", outputMode: "TEXT", timeoutMs: 60000, saveAs: "summary" },
    },
    {
      id: "n1", type: "notify", name: "通报相关人", position: { x: 110, y: 505 },
      config: { recipients: [{ type: "ROLE", id: 2, name: "部门经理" }], title: "新公文：{{outputs.h1.body.title}}", content: "{{vars.summary}}" },
    },
    { id: "end1", type: "end", name: "结束", position: { x: 260, y: 625 }, config: { output: "{{vars.summary}}" } },
  ],
  edges: [
    { id: "e1", source: "t1", target: "h1" },
    { id: "e2", source: "h1", target: "c1" },
    { id: "e3", source: "c1", target: "ai1", condition: { logic: "AND", items: [{ field: "outputs.h1.body.headerType", operator: "eq", value: "RED" }] } },
    { id: "e4", source: "c1", target: "end1", isDefault: true },
    { id: "e5", source: "ai1", target: "n1" },
    { id: "e6", source: "n1", target: "end1" },
  ],
}

const FLOWS: OrchFlow[] = [
  {
    id: 1,
    code: "doc_ai_notify",
    name: "公文签发 AI 摘要通报",
    designerJson: JSON.stringify(DEMO_MODEL),
    triggerType: "WEBHOOK",
    webhookToken: "demo-hook-9f3a",
    enabled: true,
    version: 3,
    errorFlowId: null,
    updatedAt: "2026-07-10T16:40:00",
    lastExec: { status: "SUCCESS", startedAt: "2026-07-11T09:12:00" },
  },
  {
    id: 2,
    code: "daily_report",
    name: "每日考勤汇总推送",
    designerJson: JSON.stringify({
      schemaVersion: 1, key: "daily_report", name: "每日考勤汇总推送",
      nodes: [
        { id: "t1", type: "trigger", name: "每天 9 点", position: { x: 260, y: 20 }, config: { triggerType: "CRON", cron: "0 0 9 * * ?" } },
        { id: "h1", type: "http", name: "拉考勤统计", position: { x: 235, y: 140 }, config: { method: "GET", url: "https://oa.internal/api/office/attendance/stats", responseType: "JSON" } },
        { id: "d1", type: "dataMap", name: "组装文案", position: { x: 235, y: 260 }, config: { assignments: [{ target: "text", expr: "'今日出勤 ' + outputs.h1.body.present + ' 人'" }] } },
        { id: "n1", type: "notify", name: "推送 HR", position: { x: 235, y: 380 }, config: { recipients: [{ type: "DEPT", id: 5, name: "人力资源部" }], title: "考勤日报", content: "{{vars.text}}" } },
        { id: "end1", type: "end", name: "结束", position: { x: 260, y: 500 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "t1", target: "h1" },
        { id: "e2", source: "h1", target: "d1" },
        { id: "e3", source: "d1", target: "n1" },
        { id: "e4", source: "n1", target: "end1" },
      ],
    } satisfies OrchModel),
    triggerType: "CRON",
    enabled: false,
    version: 1,
    errorFlowId: 1,
    updatedAt: "2026-07-09T11:20:00",
    lastExec: { status: "FAILED", startedAt: "2026-07-10T09:00:00" },
  },
]

let execSeq = 100
const EXECS: OrchExec[] = [
  {
    id: 92, flowId: 1, flowName: "公文签发 AI 摘要通报", triggerKind: "WEBHOOK", status: "SUCCESS",
    startedAt: "2026-07-11T09:12:00", endedAt: "2026-07-11T09:12:04",
    payload: '{"docId": 8101}', result: '"为切实加强公司信息安全管理…开展信息安全专项检查。"',
    nodes: [
      { nodeId: "t1", nodeName: "Webhook 入站", status: "SUCCESS", input: '{"docId":8101}', output: '{"docId":8101}', costMs: 1, startedAt: "2026-07-11T09:12:00" },
      { nodeId: "h1", nodeName: "取公文详情", status: "SUCCESS", input: '{"url":"https://oa.internal/api/office/doc/8101"}', output: '{"status":200,"body":{"title":"关于开展2026年度信息安全专项检查的通知","headerType":"RED"}}', costMs: 213, startedAt: "2026-07-11T09:12:00" },
      { nodeId: "c1", nodeName: "是否正式公文", status: "SUCCESS", output: '{"matched":"e3"}', costMs: 2, startedAt: "2026-07-11T09:12:00" },
      { nodeId: "ai1", nodeName: "AI 生成摘要", status: "SUCCESS", input: '{"model":"deepseek-chat"}', output: '"公司定于7月15日至8月15日开展信息安全专项检查…"', costMs: 2860, startedAt: "2026-07-11T09:12:01" },
      { nodeId: "n1", nodeName: "通报相关人", status: "SUCCESS", output: '{"notified":3}', costMs: 45, startedAt: "2026-07-11T09:12:04" },
      { nodeId: "end1", nodeName: "结束", status: "SUCCESS", costMs: 1, startedAt: "2026-07-11T09:12:04" },
    ],
  },
  {
    id: 91, flowId: 1, flowName: "公文签发 AI 摘要通报", triggerKind: "WEBHOOK", status: "FAILED",
    startedAt: "2026-07-10T18:30:00", endedAt: "2026-07-10T18:30:12", payload: '{"docId": 8099}',
    error: "节点[取公文详情] HTTP 504 Gateway Timeout（重试 3 次后失败）",
    nodes: [
      { nodeId: "t1", nodeName: "Webhook 入站", status: "SUCCESS", input: '{"docId":8099}', output: '{"docId":8099}', costMs: 1, startedAt: "2026-07-10T18:30:00" },
      { nodeId: "h1", nodeName: "取公文详情", status: "FAILED", input: '{"url":"https://oa.internal/api/office/doc/8099"}', error: "HTTP 504 Gateway Timeout（重试 3 次后失败）", costMs: 11800, startedAt: "2026-07-10T18:30:00" },
      { nodeId: "c1", nodeName: "是否正式公文", status: "SKIPPED" },
      { nodeId: "ai1", nodeName: "AI 生成摘要", status: "SKIPPED" },
      { nodeId: "n1", nodeName: "通报相关人", status: "SKIPPED" },
      { nodeId: "end1", nodeName: "结束", status: "SKIPPED" },
    ],
  },
  {
    id: 88, flowId: 2, flowName: "每日考勤汇总推送", triggerKind: "CRON", status: "FAILED",
    startedAt: "2026-07-10T09:00:00", endedAt: "2026-07-10T09:00:03", payload: "{}",
    error: "节点[拉考勤统计] 连接被拒绝",
    nodes: [
      { nodeId: "t1", nodeName: "每天 9 点", status: "SUCCESS", costMs: 1, startedAt: "2026-07-10T09:00:00" },
      { nodeId: "h1", nodeName: "拉考勤统计", status: "FAILED", error: "Connection refused", costMs: 3002, startedAt: "2026-07-10T09:00:00" },
      { nodeId: "d1", nodeName: "组装文案", status: "SKIPPED" },
      { nodeId: "n1", nodeName: "推送 HR", status: "SKIPPED" },
      { nodeId: "end1", nodeName: "结束", status: "SKIPPED" },
    ],
  },
]

const CREDENTIALS: OrchCredential[] = [
  { id: 1, name: "DeepSeek 生产", type: "LLM", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", hasKey: true },
  { id: 2, name: "内部网关 Bearer", type: "HTTP_BEARER", baseUrl: "https://oa.internal", hasKey: true },
]

let flowSeq = 10
let credSeq = 10

/* ============================ demo 包装 ============================ */

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<OrchResult<T>> {
  if (useAuthStore.getState().offline) return { data: mock(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    if (err instanceof NetworkError) return { data: mock(), demo: true }
    throw err
  }
}

/* ============================ flows ============================ */

export function fetchFlows(keyword?: string): Promise<OrchResult<OrchFlow[]>> {
  return withMock(
    async () => {
      const q = keyword ? `&keyword=${encodeURIComponent(keyword)}` : ""
      const page = await api<{ list: OrchFlow[] }>(`/api/orch/flows?pageNum=1&pageSize=100${q}`)
      return page.list
    },
    () => (keyword ? FLOWS.filter((f) => f.name.includes(keyword) || f.code.includes(keyword)) : [...FLOWS]),
  )
}

export function fetchFlow(code: string): Promise<OrchResult<OrchFlow | null>> {
  return withMock(
    () => api<OrchFlow>(`/api/orch/flows/${encodeURIComponent(code)}`),
    () => FLOWS.find((f) => f.code === code) ?? null,
  )
}

export interface SaveFlowPayload {
  id?: number | null
  code: string
  name: string
  designerJson: string
  triggerType: TriggerType
  errorFlowId?: number | null
}

export function saveFlow(payload: SaveFlowPayload): Promise<OrchResult<OrchFlow>> {
  return withMock(
    () =>
      payload.id
        ? api<OrchFlow>(`/api/orch/flows/${payload.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : api<OrchFlow>("/api/orch/flows", { method: "POST", body: JSON.stringify(payload) }),
    () => {
      const existing = FLOWS.find((f) => (payload.id ? f.id === payload.id : f.code === payload.code))
      if (existing) {
        Object.assign(existing, {
          name: payload.name,
          designerJson: payload.designerJson,
          triggerType: payload.triggerType,
          errorFlowId: payload.errorFlowId ?? null,
          updatedAt: new Date().toISOString().slice(0, 19),
        })
        return { ...existing }
      }
      const flow: OrchFlow = {
        id: ++flowSeq,
        code: payload.code,
        name: payload.name,
        designerJson: payload.designerJson,
        triggerType: payload.triggerType,
        errorFlowId: payload.errorFlowId ?? null,
        enabled: false,
        version: 1,
        updatedAt: new Date().toISOString().slice(0, 19),
      }
      FLOWS.unshift(flow)
      return { ...flow }
    },
  )
}

/** 发布 = 后端编译校验（LiteFlow EL）+ 缓存；mock 直接通过 */
export function publishFlow(id: number): Promise<OrchResult<OrchFlow>> {
  return withMock(
    () => api<OrchFlow>(`/api/orch/flows/${id}/publish`, { method: "POST" }),
    () => {
      const f = FLOWS.find((x) => x.id === id)
      if (f) f.version = (f.version ?? 0) + 1
      return { ...(f as OrchFlow) }
    },
  )
}

export function toggleFlow(id: number, enabled: boolean): Promise<OrchResult<void>> {
  return withMock(
    () => api<void>(`/api/orch/flows/${id}/${enabled ? "enable" : "disable"}`, { method: "POST" }),
    () => {
      const f = FLOWS.find((x) => x.id === id)
      if (f) f.enabled = enabled
    },
  )
}

/* ============================ run / execs ============================ */

/** 手动/测试运行：返回 execId，随后轮询 fetchExecDetail */
export function runFlow(id: number, payload: Record<string, unknown>): Promise<OrchResult<{ execId: number }>> {
  return withMock(
    () => api<{ execId: number }>(`/api/orch/flows/${id}/run`, { method: "POST", body: JSON.stringify(payload) }),
    () => {
      // mock：按 designerJson 合成一条成功流水（逐节点假耗时）
      const flow = FLOWS.find((f) => f.id === id)
      const model = flow?.designerJson ? (JSON.parse(flow.designerJson) as OrchModel) : null
      const now = new Date()
      const exec: OrchExec = {
        id: ++execSeq,
        flowId: id,
        flowName: flow?.name,
        triggerKind: "MANUAL",
        status: "SUCCESS",
        startedAt: now.toISOString().slice(0, 19),
        endedAt: new Date(now.getTime() + 1200).toISOString().slice(0, 19),
        payload: JSON.stringify(payload),
        result: '"（模拟运行）"',
        nodes: (model?.nodes ?? []).map((n, i) => ({
          nodeId: n.id,
          nodeName: n.name,
          status: "SUCCESS" as const,
          input: i === 0 ? JSON.stringify(payload) : undefined,
          output: n.type === "llm" ? '"（模拟 AI 输出）"' : n.type === "http" ? '{"status":200,"body":{}}' : undefined,
          costMs: 5 + i * 40,
          startedAt: now.toISOString().slice(0, 19),
        })),
      }
      EXECS.unshift(exec)
      if (flow) flow.lastExec = { status: "SUCCESS", startedAt: exec.startedAt }
      return { execId: exec.id }
    },
  )
}

export interface ExecQuery {
  flowId?: number
  status?: OrchExecStatus
}

export function fetchExecs(q: ExecQuery): Promise<OrchResult<OrchExec[]>> {
  return withMock(
    async () => {
      const p = new URLSearchParams({ pageNum: "1", pageSize: "100" })
      if (q.flowId != null) p.set("flowId", String(q.flowId))
      if (q.status) p.set("status", q.status)
      const page = await api<{ list: OrchExec[] }>(`/api/orch/execs?${p.toString()}`)
      return page.list
    },
    () =>
      EXECS.filter((e) => (q.flowId == null || e.flowId === q.flowId) && (!q.status || e.status === q.status)).map(
        ({ nodes: _nodes, payload: _payload, ...rest }) => rest,
      ),
  )
}

export function fetchExecDetail(id: number): Promise<OrchResult<OrchExec | null>> {
  return withMock(
    () => api<OrchExec>(`/api/orch/execs/${id}`),
    () => EXECS.find((e) => e.id === id) ?? null,
  )
}

export function rerunExec(id: number): Promise<OrchResult<{ execId: number }>> {
  return withMock(
    () => api<{ execId: number }>(`/api/orch/execs/${id}/rerun`, { method: "POST" }),
    () => {
      const src = EXECS.find((e) => e.id === id)
      const copy: OrchExec = {
        ...(src as OrchExec),
        id: ++execSeq,
        status: "SUCCESS",
        startedAt: new Date().toISOString().slice(0, 19),
        endedAt: new Date().toISOString().slice(0, 19),
        error: undefined,
        nodes: src?.nodes?.map((n) => ({ ...n, status: "SUCCESS" as const, error: undefined })),
      }
      EXECS.unshift(copy)
      return { execId: copy.id }
    },
  )
}

/* ============================ credentials ============================ */

export function fetchCredentials(): Promise<OrchResult<OrchCredential[]>> {
  return withMock(
    () => api<OrchCredential[]>("/api/orch/credentials"),
    () => [...CREDENTIALS],
  )
}

export interface SaveCredentialPayload {
  id?: number | null
  name: string
  type: CredentialType
  baseUrl?: string
  model?: string
  /** 只写不回显；留空=不修改 */
  apiKey?: string
}

export function saveCredential(payload: SaveCredentialPayload): Promise<OrchResult<OrchCredential>> {
  return withMock(
    () =>
      payload.id
        ? api<OrchCredential>(`/api/orch/credentials/${payload.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : api<OrchCredential>("/api/orch/credentials", { method: "POST", body: JSON.stringify(payload) }),
    () => {
      const existing = CREDENTIALS.find((c) => c.id === payload.id)
      if (existing) {
        Object.assign(existing, {
          name: payload.name,
          type: payload.type,
          baseUrl: payload.baseUrl,
          model: payload.model,
          hasKey: existing.hasKey || !!payload.apiKey,
        })
        return { ...existing }
      }
      const cred: OrchCredential = {
        id: ++credSeq,
        name: payload.name,
        type: payload.type,
        baseUrl: payload.baseUrl,
        model: payload.model,
        hasKey: !!payload.apiKey,
      }
      CREDENTIALS.push(cred)
      return { ...cred }
    },
  )
}

export function deleteCredential(id: number): Promise<OrchResult<void>> {
  return withMock(
    () => api<void>(`/api/orch/credentials/${id}`, { method: "DELETE" }),
    () => {
      const i = CREDENTIALS.findIndex((c) => c.id === id)
      if (i >= 0) CREDENTIALS.splice(i, 1)
    },
  )
}
