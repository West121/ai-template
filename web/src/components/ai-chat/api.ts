/**
 * AI 助手 · API 层 + mock 先行。
 *
 * V2（ai-assistant-design-v2.md 批A）：`sendChatStream` = SSE 主路径（POST /api/ai/chat/messages，
 * fetch ReadableStream）→ 建立失败自动回退旧阻塞端点 /api/ai/chat（行为兼容）→ 仍不可用回
 * **SSE mock（可控事件序列**：message.started → tool.* → text.delta → part.created → completed）。
 * 确认卡切 /api/ai/actions/{id}/confirm|cancel（Idempotency-Key 头），404 回退旧 /api/ai/confirm。
 * 业务错误（409 AI_SESSION_BUSY / 410 过期 / AI_ACTION_STALE…）不回退，按 §22 文案呈现。
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import type { AiAttachment, AiCard, AiChatResponse, AiConfirmResponse, AiMessage, AiModelOption, AiSession } from "./types"
import { formatBytes } from "./attachments"
import { cardsToParts, friendlyAiError, ulid, type AiMessagePart, type AiSseEvent } from "./protocol"
import { SseUnavailableError, streamChatMessage } from "./sse-client"

export interface AiResult<T> {
  data: T
  demo: boolean
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T | Promise<T>): Promise<AiResult<T>> {
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    // 后端整体未起（NetworkError）或 /api/ai 未实现（404）→ mock；真实 403/400 照抛
    if (err instanceof NetworkError || (err instanceof ApiError && err.code === 404)) {
      return { data: await mock(), demo: true }
    }
    throw err
  }
}

/* ============================ mock 会话存储 ============================ */

let sessionSeq = 0
const now = () => new Date().toISOString().slice(0, 19)

interface MockSession extends AiSession {
  messages: AiMessage[]
  /** 多轮上下文：记录上一次统计话题（「再按部门分一下」演示） */
  lastTopic?: "stats" | null
}

const MOCK_SESSIONS: MockSession[] = []

function mockSession(id: string | undefined): MockSession {
  let s = MOCK_SESSIONS.find((x) => x.id === id)
  if (!s) {
    s = { id: `mock-${++sessionSeq}`, title: "新会话", updatedAt: now(), messages: [] }
    MOCK_SESSIONS.unshift(s)
  }
  return s
}

/* ============================ mock 模型列表（§11） ============================ */

const MOCK_MODELS: AiModelOption[] = [
  { credentialId: 1, name: "DeepSeek", model: "deepseek-chat", supportsVision: false },
  { credentialId: 2, name: "GPT-4o", model: "gpt-4o", supportsVision: true },
  { credentialId: 3, name: "GLM-4V", model: "glm-4v", supportsVision: true },
]

/* ============================ mock 应答脑（关键词驱动演示） ============================ */

const LEAVE_SCHEMA = [
  { id: "w1", type: "select", label: "请假类型", key: "leaveType", required: true, options: ["年假", "事假", "病假", "调休"], width: "full" as const },
  { id: "w2", type: "date", label: "开始日期", key: "startDate", required: true, width: "half" as const },
  { id: "w3", type: "date", label: "结束日期", key: "endDate", required: true, width: "half" as const },
  { id: "w4", type: "number", label: "请假天数", key: "days", required: true, width: "half" as const },
  { id: "w5", type: "textarea", label: "请假事由", key: "reason", required: true, width: "full" as const },
]

function mockReply(text: string, session: MockSession, opts?: ChatOpts): AiMessage {
  const t = text.toLowerCase()
  const has = (...kws: string[]) => kws.some((k) => text.includes(k) || t.includes(k))
  const cards: AiCard[] = []
  let content: string

  // §11 多模态演示：带附件优先按附件应答
  const atts = opts?.attachments ?? []
  if (atts.length > 0) {
    const model = MOCK_MODELS.find((m) => m.credentialId === opts?.credentialId) ?? MOCK_MODELS[0]
    const images = atts.filter((a) => a.kind === "IMAGE")
    const texts = atts.filter((a) => a.kind === "TEXT")
    if (images.length > 0 && !model.supportsVision) {
      // 后端真实路径为 400 明确文案；mock 以助手消息演示同一文案
      return {
        role: "ASSISTANT",
        content:
          `当前模型 **${model.name}（${model.model}）** 不支持图片理解。\n\n` +
          "请在输入框上方的模型选择器切换到带 👁 徽标的视觉模型（如 GPT-4o / GLM-4V）后重新发送图片。",
        createdAt: now(),
      }
    }
    const parts: string[] = []
    if (images.length > 0) {
      parts.push(`收到 ${images.length} 张图片（${images.map((a) => a.name).join("、")}）。演示模式下没有真实视觉模型；接入后端后可识别票据、截图、表格照片等内容。`)
    }
    if (texts.length > 0) {
      parts.push(
        texts
          .map((a) => `已读取文本文件《${a.name}》${a.size != null ? `（${formatBytes(a.size)}）` : ""}，内容将以引用块注入上下文（超 16k 字符截断）。`)
          .join("\n"),
      )
    }
    if (text.trim()) parts.push(`你的问题「${text}」我会结合附件内容回答——演示模式先回显附件解析结果。`)
    return { role: "ASSISTANT", content: parts.join("\n\n"), createdAt: now() }
  }

  if (has("待办", "todo", "要处理", "急")) {
    content = has("急")
      ? "按 **超时 48 小时未办、加急标记、催办** 打分排序，你现在最该处理这几件："
      : "这是你的待办列表（按到达时间倒序），点击行可直达办理页："
    cards.push({
      type: "list",
      title: has("急") ? "急事优先" : "我的待办",
      columns: [
        { key: "title", label: "标题" },
        { key: "node", label: "节点" },
        { key: "arrivedAt", label: "到达" },
      ],
      rows: [
        { title: "〔特急〕关于开展信息安全专项检查的通知 · 签发", node: "签发", arrivedAt: "2 天前", link: "/workflow/tasks" },
        { title: "张三的请假申请（3 天）", node: "部门主管审批", arrivedAt: "5 小时前", link: "/workflow/tasks" },
        { title: "采购申请 · 金额 ¥42,000", node: "总经理审批", arrivedAt: "昨天", link: "/workflow/tasks" },
      ],
      moreLink: "/workflow/tasks",
    })
    session.lastTopic = null
  } else if (has("统计", "报表", "图表", "审批量")) {
    content = "这是**本月审批量按流程**的统计（数据权限范围内）："
    cards.push({
      type: "chart",
      chartType: "bar",
      title: "本月审批量 · 按流程",
      categories: ["请假", "报销", "采购", "用章", "出差"],
      series: [
        { name: "已通过", data: [42, 31, 12, 20, 9] },
        { name: "进行中", data: [8, 12, 6, 3, 4] },
      ],
    })
    session.lastTopic = "stats"
  } else if (session.lastTopic === "stats" && has("部门", "再按", "换个维度")) {
    content = "好的，换成**按部门**的占比视角："
    cards.push({
      type: "chart",
      chartType: "pie",
      title: "本月审批量 · 按部门",
      series: [
        { name: "研发中心", data: [58], percent: 39.2 },
        { name: "市场部", data: [34], percent: 23.0 },
        { name: "人力资源部", data: [26], percent: 17.6 },
        { name: "财务部", data: [18], percent: 12.2 },
        { name: "综合办公室", data: [12], percent: 8.1 },
      ],
    })
  } else if (has("趋势", "走势", "折线")) {
    content = "近六个月的审批量趋势如下："
    cards.push({
      type: "chart",
      chartType: "line",
      title: "审批量趋势（近 6 月）",
      categories: ["2月", "3月", "4月", "5月", "6月", "7月"],
      series: [{ name: "审批量", data: [96, 120, 88, 132, 150, 141] }],
    })
    session.lastTopic = "stats"
  } else if (has("请假")) {
    content = "好的，帮你调出**请假申请**表单，填写后我直接为你发起流程："
    cards.push({
      type: "form",
      defCode: "leave_flow",
      defName: "请假申请",
      formType: "ONLINE",
      schema: LEAVE_SCHEMA,
    })
    session.lastTopic = null
  } else if (has("发文", "公文")) {
    content = "发文办理单是代码表单，需要在拟稿页填写（含红头版式预览）。点下面直接过去："
    cards.push({
      type: "form",
      defCode: "gw_send",
      defName: "发文办理单",
      formType: "CODE",
      submitPath: "/document/send?new=1",
    })
    session.lastTopic = null
  } else if (has("同意", "通过", "批准")) {
    content = "确认要**同意**这条审批吗？我不会直接操作，请你确认后才会执行："
    cards.push({
      type: "confirm",
      actionId: `act-${Date.now()}`,
      title: "同意审批任务",
      summary: "执行后该任务办结并流转到下一节点",
      params: [
        { label: "任务", value: "张三的请假申请（3 天）" },
        { label: "节点", value: "部门主管审批" },
        { label: "意见", value: "同意" },
      ],
    })
  } else if (has("驳回", "拒绝", "删除")) {
    content = "这是一个**不可逆的危险操作**，请再次确认："
    cards.push({
      type: "confirm",
      actionId: `act-danger-${Date.now()}`,
      title: has("删除") ? "删除日程「周会」" : "驳回审批任务",
      summary: "执行后不可恢复，请谨慎确认",
      params: [
        { label: "对象", value: has("删除") ? "周会（每周一 10:00）" : "采购申请 · ¥42,000" },
        { label: "操作", value: has("删除") ? "删除" : "驳回至发起人" },
      ],
      danger: true,
    })
  } else if (has("过期", "expired")) {
    content = "演示一个**已过期**的确认卡（待确认动作 10 分钟过期）："
    cards.push({
      type: "confirm",
      actionId: "act-expired-demo",
      title: "同意审批任务（演示过期）",
      params: [{ label: "任务", value: "旧的待确认动作" }],
    })
  } else if (has("导航", "打开", "去", "带我")) {
    content = "为你找到了对应功能："
    cards.push(
      { type: "navigate", path: "/workflow/tasks", title: "我的审批", desc: "待办 / 待阅 / 已办 / 我发起" },
      { type: "link", items: [
        { title: "发起申请", path: "/workflow/start" },
        { title: "流程监控", path: "/workflow/monitor" },
      ] },
    )
  } else if (has("功能", "能做什么", "会什么", "帮助", "你好", "hi", "hello")) {
    content =
      "你好！我是**星辰助手**，可以帮你：\n\n" +
      "- **查数据**：待办、公文、会议、考勤、假期余额（严格按你的数据权限）\n" +
      "- **办事情**：发起审批、同意/驳回任务（都会先出确认卡，你点确认才执行）\n" +
      "- **看报表**：审批量、公文、考勤出勤率等统计图表\n" +
      "- **找功能**：说出想做的事，我带你去对应页面\n\n试试下面的快捷入口："
    cards.push({
      type: "link",
      items: [
        { title: "查我的待办", path: "/workflow/tasks" },
        { title: "发起申请", path: "/workflow/start" },
        { title: "公文管理", path: "/document/send" },
        { title: "自动化编排", path: "/automation" },
      ],
    })
  } else {
    content =
      `收到：「${text}」。\n\n当前为**演示模式**（后端 /api/ai 未接入），我预置了这些演示：\n\n` +
      "1. 「你能做什么」— 功能介绍\n" +
      "2. 「查我的待办」/「我现在最急的事」— 列表卡\n" +
      "3. 「本月审批量统计」→ 再问「再按部门分一下」— 图表卡 + 多轮上下文\n" +
      "4. 「我要请假」— 表单卡；「我要发文」— CODE 表单跳转\n" +
      "5. 「同意这条审批」/「驳回它」/「演示过期」— 确认卡全状态\n" +
      "6. 「带我去审批中心」— 导航卡\n" +
      "7. 点回形针附图片/文本文件 — 多模态演示（DeepSeek 附图会提示切换视觉模型）"
  }

  return { role: "ASSISTANT", content, cards: cards.length ? cards : undefined, createdAt: now() }
}

/* ============================ API ============================ */

/** chat 可选项（§11）：模型切换（credentialId/model，存 session）+ 多模态附件 */
export interface ChatOpts {
  credentialId?: number
  model?: string
  attachments?: AiAttachment[]
}

/** 发消息（sessionId 空=新会话）。mock：0.6s 假延迟出打字态 */
export function sendChat(sessionId: string | undefined, message: string, opts?: ChatOpts): Promise<AiResult<AiChatResponse>> {
  return withMock(
    () =>
      api<AiChatResponse>("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          message,
          credentialId: opts?.credentialId,
          model: opts?.model,
          attachments: opts?.attachments?.map((a) => ({ kind: a.kind, name: a.name, dataUrl: a.dataUrl, fileId: a.fileId })),
        }),
      }),
    async () => {
      await new Promise((r) => setTimeout(r, 600))
      const session = mockSession(sessionId)
      if (session.messages.length === 0) session.title = message.slice(0, 20) || "附件对话"
      const userMsg: AiMessage = { role: "USER", content: message, attachments: opts?.attachments, createdAt: now() }
      const reply = mockReply(message, session, opts)
      session.messages.push(userMsg, reply)
      session.updatedAt = now()
      return { sessionId: session.id, messages: [reply] }
    },
  )
}

/** GET /api/ai/models：可选凭据列表（启用的 LLM 型，含 supportsVision） */
export function fetchModels(): Promise<AiResult<AiModelOption[]>> {
  return withMock(
    () => api<AiModelOption[]>("/api/ai/models"),
    () => [...MOCK_MODELS],
  )
}

/** 确认执行暂存动作（10min 过期）。mock：过期演示 actionId 返回 expired */
export function confirmAction(actionId: string): Promise<AiResult<AiConfirmResponse>> {
  return withMock(
    () => api<AiConfirmResponse>("/api/ai/confirm", { method: "POST", body: JSON.stringify({ actionId }) }),
    async () => {
      await new Promise((r) => setTimeout(r, 500))
      if (actionId.startsWith("act-expired")) {
        return { ok: false, expired: true }
      }
      return { ok: true, message: "已执行", resultLink: "/workflow/tasks?tab=done" }
    },
  )
}

export function fetchSessions(): Promise<AiResult<AiSession[]>> {
  return withMock(
    () => api<AiSession[]>("/api/ai/sessions"),
    () => MOCK_SESSIONS.map(({ messages: _m, lastTopic: _t, ...rest }) => rest),
  )
}

export function fetchSessionMessages(id: string): Promise<AiResult<AiMessage[]>> {
  return withMock(
    () => api<AiMessage[]>(`/api/ai/sessions/${encodeURIComponent(id)}/messages`),
    () => MOCK_SESSIONS.find((s) => s.id === id)?.messages ?? [],
  )
}

export function deleteSession(id: string): Promise<AiResult<void>> {
  return withMock(
    () => api<void>(`/api/ai/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    () => {
      const i = MOCK_SESSIONS.findIndex((s) => s.id === id)
      if (i >= 0) MOCK_SESSIONS.splice(i, 1)
    },
  )
}

/* ============================ V2：流式发送编排（SSE → 阻塞回退 → SSE mock） ============================ */

/** 工具状态条条目（§9.2 displayName 驱动，「正在查询我的待办…✓」） */
export interface ToolStatusItem {
  id: string
  displayName: string
  state: "running" | "done" | "failed"
}

/** 流式事件 → UI 回调（assistant.tsx 按此驱动打字态/状态条/逐卡片落地） */
export interface ChatStreamHandlers {
  /** message.started：出打字态/助手占位气泡 */
  onStarted?: () => void
  /** message.text.delta：正文增量 */
  onTextDelta?: (text: string) => void
  /** tool.started / tool.completed / tool.failed：工具状态条 */
  onToolStatus?: (item: ToolStatusItem) => void
  /** message.part.created：逐卡片落进消息流 */
  onPart?: (part: AiMessagePart) => void
  /** 回退路径（旧阻塞端点）：整条助手消息（旧 cards 形状） */
  onAssistantMessage?: (msg: AiMessage) => void
}

export interface ChatSendRequest {
  sessionId?: string
  /** 前端生成 ULID（重试沿用同一 id，服务端幂等去重） */
  clientMessageId: string
  message: string
  credentialId?: number
  model?: string
  attachments?: AiAttachment[]
}

export interface ChatStreamOutcome {
  sessionId?: string
  demo: boolean
  /** sse=流式主路径；fallback=旧阻塞端点；mock=演示 */
  mode: "sse" | "fallback" | "mock"
}

/** SSE 事件分发到 handlers；捕获 sessionId 与 message.failed（有则由上层抛出） */
function dispatchEvent(evt: AiSseEvent, h: ChatStreamHandlers, acc: { sessionId?: string; failed?: string }) {
  if (evt.sessionId) acc.sessionId = evt.sessionId
  const p = evt.payload ?? {}
  switch (evt.type) {
    case "message.started":
      h.onStarted?.()
      break
    case "message.text.delta":
      if (typeof p.text === "string") h.onTextDelta?.(p.text)
      else if (typeof p.delta === "string") h.onTextDelta?.(p.delta)
      break
    case "tool.started":
      h.onToolStatus?.({ id: String(p.toolCallId ?? ""), displayName: String(p.displayName ?? "正在执行工具"), state: "running" })
      break
    case "tool.completed":
      h.onToolStatus?.({ id: String(p.toolCallId ?? ""), displayName: String(p.displayName ?? "工具执行完成"), state: "done" })
      break
    case "tool.failed":
      h.onToolStatus?.({ id: String(p.toolCallId ?? ""), displayName: String(p.displayName ?? "工具执行失败"), state: "failed" })
      break
    case "message.part.created": {
      const part = (p.part ?? p) as Partial<AiMessagePart>
      if (part && typeof part.partType === "string") {
        h.onPart?.({
          partId: String(part.partId ?? `pt_${ulid()}`),
          partType: part.partType,
          schemaVersion: typeof part.schemaVersion === "number" ? part.schemaVersion : 1,
          payload: (part.payload as Record<string, unknown>) ?? {},
          sequenceNo: typeof part.sequenceNo === "number" ? part.sequenceNo : 0,
        })
      }
      break
    }
    case "message.failed":
      acc.failed = typeof p.message === "string" && p.message ? p.message : typeof p.code === "string" ? p.code : "回复失败"
      break
    case "message.completed":
    case "action.status.changed":
    default:
      break
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** SSE mock：把关键词应答脑的产物按可控事件序列回放（parts 形状 + 工具状态演示） */
async function runMockStream(req: ChatSendRequest, h: ChatStreamHandlers): Promise<ChatStreamOutcome> {
  const session = mockSession(req.sessionId)
  if (session.messages.length === 0) session.title = req.message.slice(0, 20) || "附件对话"
  const userMsg: AiMessage = {
    role: "USER",
    content: req.message,
    attachments: req.attachments?.length ? req.attachments : undefined,
    clientMessageId: req.clientMessageId,
    createdAt: now(),
  }
  const reply = mockReply(req.message, session, { credentialId: req.credentialId, model: req.model, attachments: req.attachments })
  const parts = cardsToParts(reply.cards)

  await delay(250)
  h.onStarted?.()

  // 工具状态条演示（按卡片种类推断 displayName）
  const kinds = new Set((reply.cards ?? []).map((c) => c.type))
  const toolName = kinds.has("list")
    ? "正在查询我的待办"
    : kinds.has("chart")
      ? "正在生成统计数据"
      : kinds.has("form")
        ? "正在调取表单定义"
        : kinds.has("confirm")
          ? "正在准备操作预览"
          : req.attachments?.length
            ? "正在解析附件"
            : null
  if (toolName) {
    const id = `tc_${ulid()}`
    h.onToolStatus?.({ id, displayName: toolName, state: "running" })
    await delay(420)
    h.onToolStatus?.({ id, displayName: toolName, state: "done" })
  }

  // 正文分两段 delta（演示打字流）
  const mid = Math.ceil(reply.content.length / 2)
  h.onTextDelta?.(reply.content.slice(0, mid))
  await delay(160)
  h.onTextDelta?.(reply.content.slice(mid))

  for (const part of parts) {
    await delay(120)
    h.onPart?.(part)
  }

  session.messages.push(userMsg, { ...reply, parts: parts.length ? parts : undefined })
  session.updatedAt = now()
  return { sessionId: session.id, demo: true, mode: "mock" }
}

/**
 * 发送消息（V2 主入口）：
 * 1) SSE（POST /api/ai/chat/messages，fetch ReadableStream）；
 * 2) 通道不可用（网络/404/非流响应）→ 旧阻塞端点 /api/ai/chat（行为兼容）；
 * 3) 旧端点也不可用 → SSE mock；
 * 业务错误（409/410/§22 码）不回退，转文案后抛出。message.failed 事件同样以异常抛出。
 */
export async function sendChatStream(req: ChatSendRequest, h: ChatStreamHandlers): Promise<ChatStreamOutcome> {
  if (useAuthStore.getState().offline) return runMockStream(req, h)

  // ---- 1) SSE 主路径 ----
  try {
    const acc: { sessionId?: string; failed?: string } = {}
    await streamChatMessage(
      {
        sessionId: req.sessionId,
        clientMessageId: req.clientMessageId,
        message: req.message,
        credentialId: req.credentialId,
        model: req.model,
        attachments: req.attachments?.map((a) => ({ kind: a.kind, name: a.name, dataUrl: a.dataUrl, fileId: a.fileId })),
      },
      (evt) => dispatchEvent(evt, h, acc),
    )
    if (acc.failed) throw new ApiError(500, friendlyAiError(new Error(acc.failed)))
    return { sessionId: acc.sessionId ?? req.sessionId, demo: false, mode: "sse" }
  } catch (err) {
    const channelDown = err instanceof SseUnavailableError || err instanceof NetworkError || (err instanceof ApiError && err.code === 404)
    if (!channelDown) {
      // 业务错误：§22 文案化后抛出（不回退）
      throw err instanceof ApiError ? new ApiError(err.code, friendlyAiError(err)) : err
    }
  }

  // ---- 2) 旧阻塞端点回退（行为兼容） ----
  try {
    const res = await api<AiChatResponse>("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId: req.sessionId,
        message: req.message,
        clientMessageId: req.clientMessageId,
        credentialId: req.credentialId,
        model: req.model,
        attachments: req.attachments?.map((a) => ({ kind: a.kind, name: a.name, dataUrl: a.dataUrl, fileId: a.fileId })),
      }),
    })
    h.onStarted?.()
    for (const msg of res.messages) h.onAssistantMessage?.(msg)
    return { sessionId: res.sessionId, demo: false, mode: "fallback" }
  } catch (err) {
    if (err instanceof NetworkError || (err instanceof ApiError && err.code === 404)) {
      // ---- 3) SSE mock ----
      return runMockStream(req, h)
    }
    throw err instanceof ApiError ? new ApiError(err.code, friendlyAiError(err)) : err
  }
}

/* ============================ V2：确认 / 取消（持久化动作草稿，§7） ============================ */

/** V2 确认响应（status 含 EXECUTING 过渡态；兼容旧 ok/expired 形状） */
export interface AiActionResult {
  ok: boolean
  status?: "CONFIRMED" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED"
  message?: string
  resultLink?: string
  expired?: boolean
  /** AI_ACTION_STALE：状态已变化，请重新查询 */
  stale?: boolean
}

/**
 * 确认执行（V2）：POST /api/ai/actions/{id}/confirm + **Idempotency-Key**（前端 ULID，
 * 同一动作重试沿用同一 key）；请求体为空对象（§7.3：执行参数以服务端草稿为准）。
 * 404（新端点未实现）→ 回退旧 /api/ai/confirm → 仍不可用回 mock 演示。
 * 409/410/AI_ACTION_STALE 等业务错误按 §22 文案转结构化状态。
 */
export async function confirmActionV2(actionId: string, idempotencyKey: string): Promise<AiResult<AiActionResult>> {
  try {
    const data = await api<AiActionResult>(`/api/ai/actions/${encodeURIComponent(actionId)}/confirm`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({}),
    })
    return { data, demo: false }
  } catch (err) {
    if (err instanceof ApiError && err.code !== 404) {
      const text = friendlyAiError(err)
      if (err.code === 410 || /AI_ACTION_EXPIRED/.test(err.message)) return { data: { ok: false, expired: true, message: text }, demo: false }
      if (/AI_ACTION_STALE/.test(err.message)) return { data: { ok: false, stale: true, message: text }, demo: false }
      if (/AI_ACTION_ALREADY_EXECUTED/.test(err.message)) return { data: { ok: true, status: "SUCCEEDED", message: text }, demo: false }
      throw new ApiError(err.code, text)
    }
    if (!(err instanceof NetworkError) && !(err instanceof ApiError)) throw err
    // 新端点未实现/网络不可用 → 旧端点（其内部含 mock 兜底）
    const legacy = await confirmAction(actionId)
    return { data: { ...legacy.data }, demo: legacy.demo }
  }
}

/** 取消（V2）：POST /api/ai/actions/{id}/cancel；端点不可用时静默成功（本地已置取消态） */
export async function cancelActionV2(actionId: string): Promise<void> {
  try {
    await api<void>(`/api/ai/actions/${encodeURIComponent(actionId)}/cancel`, { method: "POST", body: JSON.stringify({}) })
  } catch (err) {
    if (err instanceof NetworkError || (err instanceof ApiError && err.code === 404)) return
    throw err
  }
}
