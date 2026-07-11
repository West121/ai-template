/**
 * AI 助手 V2 协议层（ai-assistant-design-v2.md §9 SSE / §9.3 Part / §10 卡片 / §22 错误码）。
 * 纯逻辑（无 React）：ULID、SSE 增量解析器、Part 白名单与 schemaVersion 降级判定、
 * 新旧协议适配（parts ↔ 旧 cards）、featureCode 受控导航映射（批C 全量，此处先落骨架）、错误码文案。
 */
import type { AiCard } from "./types"

/* ============================ ULID（clientMessageId / Idempotency-Key） ============================ */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** ULID：48bit 毫秒时间戳 + 80bit 随机（crypto），26 字符 Crockford Base32，可排序 */
export function ulid(now: number = Date.now()): string {
  let ts = now
  const time = new Array<string>(10)
  for (let i = 9; i >= 0; i--) {
    time[i] = CROCKFORD[ts % 32]
    ts = Math.floor(ts / 32)
  }
  const rnd = new Uint8Array(16)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(rnd)
  else for (let i = 0; i < 16; i++) rnd[i] = Math.floor(Math.random() * 256)
  let out = time.join("")
  for (let i = 0; i < 16; i++) out += CROCKFORD[rnd[i] % 32]
  return out
}

/* ============================ SSE 事件（§9.2） ============================ */

export type AiSseEventType =
  | "message.started"
  | "message.text.delta"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "message.part.created"
  | "action.status.changed"
  | "message.completed"
  | "message.failed"

export interface AiSseEvent {
  sessionId?: string
  messageId?: string
  sequence?: number
  type: AiSseEventType | (string & {})
  timestamp?: string
  payload?: Record<string, unknown>
}

/** 原始 SSE 帧（event 字段可缺省：type 在 data JSON 内） */
export interface SseFrame {
  event?: string
  data: string
  id?: string
}

/**
 * 增量 SSE 解析器（fetch ReadableStream 消费，chunk 可在任意位置断开）：
 * 按空行分帧，聚合多条 data:，容忍 CRLF 与 `:` 注释（keepalive）。
 */
export function createSseParser(onFrame: (frame: SseFrame) => void) {
  let buffer = ""
  let event: string | undefined
  let id: string | undefined
  let dataLines: string[] = []

  const flushFrame = () => {
    if (dataLines.length === 0 && event === undefined) {
      event = undefined
      id = undefined
      return
    }
    onFrame({ event, id, data: dataLines.join("\n") })
    event = undefined
    id = undefined
    dataLines = []
  }

  const handleLine = (line: string) => {
    if (line === "") {
      flushFrame()
      return
    }
    if (line.startsWith(":")) return // 注释/keepalive
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    if (field === "data") dataLines.push(value)
    else if (field === "event") event = value
    else if (field === "id") id = value
    // retry 等字段忽略
  }

  return {
    /** 喂入一段文本（TextDecoder stream 输出） */
    feed(chunk: string) {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf("\n")) >= 0) {
        let line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (line.endsWith("\r")) line = line.slice(0, -1)
        handleLine(line)
      }
    },
    /** 流结束：残留半帧按结束处理 */
    end() {
      if (buffer !== "") {
        handleLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer)
        buffer = ""
      }
      flushFrame()
    },
  }
}

/** SSE 帧 → 事件对象（type 优先取 data JSON 内字段，缺省回退 event 名）；非法 JSON 回 null */
export function parseAiEvent(frame: SseFrame): AiSseEvent | null {
  if (!frame.data.trim()) return null
  try {
    const obj = JSON.parse(frame.data) as Record<string, unknown>
    const type = (typeof obj.type === "string" ? obj.type : frame.event) ?? ""
    if (!type) return null
    return {
      sessionId: typeof obj.sessionId === "string" ? obj.sessionId : undefined,
      messageId: typeof obj.messageId === "string" ? obj.messageId : undefined,
      sequence: typeof obj.sequence === "number" ? obj.sequence : undefined,
      type,
      timestamp: typeof obj.timestamp === "string" ? obj.timestamp : undefined,
      payload: (obj.payload as Record<string, unknown>) ?? undefined,
    }
  } catch {
    return null
  }
}

/* ============================ 消息 Part 协议（§9.3 / §10.1） ============================ */

export interface AiMessagePart {
  partId: string
  partType: string
  schemaVersion: number
  payload: Record<string, unknown>
  sequenceNo: number
}

/** 卡片/内容白名单（§10.1 + text）：不在名单内一律降级组件 */
export const PART_TYPES = ["text", "navigate", "form", "confirm", "list", "chart", "approval", "status", "error", "plan"] as const
export type KnownPartType = (typeof PART_TYPES)[number]

/** 各 partType 当前支持的最高 schemaVersion（§16.3：更高版本走降级组件） */
export const PART_SCHEMA_SUPPORT: Record<KnownPartType, number> = {
  text: 1,
  navigate: 1,
  form: 1,
  confirm: 1,
  list: 1,
  chart: 1,
  approval: 1,
  status: 1,
  error: 1,
  plan: 1,
}

export type PartResolution =
  | { status: "ok"; type: KnownPartType }
  | { status: "degraded"; reason: "unknown-type" | "unsupported-version" | "malformed" }

/** Part 渲染判定：白名单 partType + schemaVersion ≤ 支持上限，否则降级（不抛错不空白） */
export function resolvePart(part: Partial<AiMessagePart> | null | undefined): PartResolution {
  if (!part || typeof part.partType !== "string" || part.payload == null || typeof part.payload !== "object") {
    return { status: "degraded", reason: "malformed" }
  }
  const type = part.partType as KnownPartType
  if (!(PART_TYPES as readonly string[]).includes(type)) return { status: "degraded", reason: "unknown-type" }
  const v = typeof part.schemaVersion === "number" ? part.schemaVersion : 1
  if (v > PART_SCHEMA_SUPPORT[type]) return { status: "degraded", reason: "unsupported-version" }
  return { status: "ok", type }
}

/* ============================ featureCode 受控导航（§10.2；批C 出全量 Registry，此处先落骨架） ============================ */

/** featureCode → 路由模板（`{param}` 占位从 routeParams 取；全站 path 即唯一键约定不破坏） */
export const FEATURE_ROUTES: Record<string, string> = {
  WF_MY_TODO: "/workflow/tasks",
  WF_START: "/workflow/start",
  WF_MONITOR: "/workflow/monitor",
  WF_INSTANCE_DETAIL: "/workflow/instances/{instanceId}",
  WF_TASK_DETAIL: "/workflow/tasks",
  DOC_SEND: "/document/send",
  DOC_RECEIVE: "/document/receive",
  MEETING_LIST: "/office/meeting",
  BIZDOC_CENTER: "/bizdoc/center",
}

/** featureCode + routeParams → 站内路径；未知 code / 缺参 → null（渲染禁用态，不执行任意 URL） */
export function resolveFeaturePath(featureCode: string | undefined, routeParams?: Record<string, unknown>): string | null {
  if (!featureCode) return null
  const tpl = FEATURE_ROUTES[featureCode]
  if (!tpl) return null
  let missing = false
  const path = tpl.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = routeParams?.[key]
    if (v == null || v === "") {
      missing = true
      return ""
    }
    return encodeURIComponent(String(v))
  })
  return missing ? null : path
}

/* ============================ 新旧协议适配（兼容读旧 cards / mock 升级） ============================ */

/** 旧 AiCard → V2 Part（mock/兼容层用；link 卡无 v2 对应，保持 navigate 组合语义拆开） */
export function cardToPart(card: AiCard, sequenceNo: number): AiMessagePart {
  const { type, ...rest } = card as AiCard & Record<string, unknown>
  if (type === "confirm") {
    const c = card as Extract<AiCard, { type: "confirm" }>
    return {
      partId: `pt_${ulid()}`,
      partType: "confirm",
      schemaVersion: 1,
      sequenceNo,
      payload: {
        actionId: c.actionId,
        title: c.title,
        summary: c.summary,
        displayParams: c.params,
        riskLevel: c.danger ? "CONFIRM_REQUIRED" : "CONFIRM_REQUIRED",
        danger: c.danger,
      },
    }
  }
  return { partId: `pt_${ulid()}`, partType: type, schemaVersion: 1, sequenceNo, payload: rest }
}

/**
 * V2 Part → 旧 AiCard（复用现有六类卡片组件渲染）：
 * navigate 支持 v2 featureCode（经受控映射）与过渡期 path；confirm 映射 displayParams/riskLevel。
 * 无法映射（如未知 featureCode）回 null，由调用方降级。
 */
export function partToCard(part: AiMessagePart): AiCard | null {
  const p = part.payload
  switch (part.partType) {
    case "navigate": {
      const path = typeof p.path === "string" ? p.path : resolveFeaturePath(p.featureCode as string | undefined, p.routeParams as Record<string, unknown>)
      if (!path) return null
      return { type: "navigate", path, title: String(p.title ?? "打开页面"), desc: typeof p.desc === "string" ? p.desc : undefined }
    }
    case "confirm": {
      const params = (p.displayParams ?? p.params) as { label: string; value: string }[] | undefined
      if (typeof p.actionId !== "string" || typeof p.title !== "string") return null
      return {
        type: "confirm",
        actionId: p.actionId,
        title: p.title,
        summary: typeof p.summary === "string" ? p.summary : undefined,
        params,
        danger: p.danger === true,
        expiresAt: typeof p.expiresAt === "string" ? p.expiresAt : undefined,
      }
    }
    case "form":
      return { type: "form", ...(p as object) } as AiCard
    case "list":
      return { type: "list", ...(p as object) } as AiCard
    case "chart":
      return { type: "chart", ...(p as object) } as AiCard
    default:
      return null
  }
}

/** 旧 cards → parts（mock/兼容层）：link 卡拆成多个 navigate part（v2 无 link 类型） */
export function cardsToParts(cards: AiCard[] | undefined): AiMessagePart[] {
  if (!cards?.length) return []
  const out: AiMessagePart[] = []
  let seq = 1
  for (const card of cards) {
    if (card.type === "link") {
      for (const item of card.items) {
        out.push({ partId: `pt_${ulid()}`, partType: "navigate", schemaVersion: 1, sequenceNo: seq++, payload: { path: item.path, title: item.title } })
      }
      continue
    }
    out.push(cardToPart(card, seq++))
  }
  return out
}

/* ============================ 批B：Part 覆盖合并 / 模型档案回退映射 ============================ */

/**
 * SSE part 合并（计划卡逐步打勾等）：同 partId 的后到 part **覆盖**先到（后端推送更新态），
 * 否则追加。纯函数（渲染层按 sequenceNo 排序不受影响）。
 */
export function mergePart(parts: AiMessagePart[], incoming: AiMessagePart): AiMessagePart[] {
  const i = parts.findIndex((p) => p.partId === incoming.partId)
  if (i >= 0) return parts.map((p, x) => (x === i ? incoming : p))
  return [...parts, incoming]
}

/** 旧 /api/ai/models 凭据 → 选择器统一条目（model-profiles 404 时的兼容回退，§4.3） */
export function legacyModelsToChoices(
  models: { credentialId: number; name: string; model: string; supportsVision?: boolean }[],
): { id: string; name: string; description?: string; supportsVision?: boolean; legacyCredentialId: number; legacyModel: string }[] {
  return models.map((m) => ({
    id: `cred:${m.credentialId}`,
    name: m.name,
    description: m.model,
    supportsVision: m.supportsVision,
    legacyCredentialId: m.credentialId,
    legacyModel: m.model,
  }))
}

/* ============================ 错误码文案（§22，可修复/需重查/权限/系统） ============================ */

export const AI_ERROR_TEXT: Record<string, string> = {
  AI_SESSION_NOT_FOUND: "会话不存在或已被删除，请新建会话。",
  AI_SESSION_BUSY: "助手正在处理这个会话的上一条消息，请稍候再发。",
  AI_MESSAGE_DUPLICATE: "这条消息已经发送过了（幂等去重），无需重试。",
  AI_MODEL_UNAVAILABLE: "所选模型暂时不可用，请稍后重试或切换模型。",
  AI_MODEL_NOT_ALLOWED: "当前账号不允许使用该模型，请切换模型档案。",
  AI_QUOTA_EXCEEDED: "本时段的 AI 用量已达上限，请稍后再试。",
  AI_TOOL_NOT_ALLOWED: "该操作涉及你无权使用的功能，已被拦截。",
  AI_TOOL_TIMEOUT: "工具执行超时，请重试；若持续失败请稍后再来。",
  AI_TOOL_INVALID_ARGUMENT: "参数不完整或不合法，请补充信息后重试。",
  AI_DATA_SCOPE_DENIED: "数据权限不足：目标数据不在你的可见范围内。",
  AI_ACTION_NOT_FOUND: "待确认操作不存在，可能已被清理，请重新发起。",
  AI_ACTION_EXPIRED: "此操作已过期，请重新发起。",
  AI_ACTION_ALREADY_EXECUTED: "该操作已执行过，请勿重复确认（可查看执行结果）。",
  AI_ACTION_STALE: "该对象状态已经变化，请重新查询后再操作。",
  AI_ACTION_CONFIRM_REQUIRED: "该操作需要确认后才能执行。",
  AI_ATTACHMENT_NOT_SUPPORTED: "附件类型不支持（图片 png/jpg/webp 或文本 txt/md/csv/json/log）。",
  AI_ATTACHMENT_TOO_LARGE: "附件超出大小限制（图片 ≤5MB，文本 ≤1MB）。",
  AI_RAG_NO_RESULT: "没有检索到相关的功能说明。",
}

/**
 * 错误 → 用户文案：识别 §22 错误码（message 或 code 字段携带）+ HTTP 语义（409 忙 / 410 过期）。
 */
export function friendlyAiError(err: unknown, fallback = "请求失败，请稍后重试"): string {
  const raw = err instanceof Error ? err.message : String(err ?? "")
  const codeMatch = /AI_[A-Z_]+/.exec(raw)
  if (codeMatch && AI_ERROR_TEXT[codeMatch[0]]) return AI_ERROR_TEXT[codeMatch[0]]
  const httpCode = (err as { code?: unknown })?.code
  if (httpCode === 409) return AI_ERROR_TEXT.AI_SESSION_BUSY
  if (httpCode === 410) return AI_ERROR_TEXT.AI_ACTION_EXPIRED
  return raw || fallback
}
