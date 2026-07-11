/**
 * SSE 客户端（附2 第 6 条：POST 流式必须用 fetch ReadableStream，EventSource 不支持 POST）。
 * POST /api/ai/chat/messages，Accept: text/event-stream；逐 chunk 喂增量解析器（protocol.ts），
 * 解析出的事件回调给调用方。**建立失败分类**：
 *  - 业务错误（后端回 JSON envelope，如 409 AI_SESSION_BUSY）→ 抛 ApiError（不回退，直接呈现文案）；
 *  - 网络不通 / 404 未实现 / 响应不是 event-stream → 抛 SseUnavailableError（调用方回退旧阻塞端点）。
 */
import { ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import { createSseParser, parseAiEvent, type AiSseEvent } from "./protocol"

/** SSE 通道不可用（网络/未实现/非流响应）→ 触发回退，非业务错误 */
export class SseUnavailableError extends Error {
  constructor(message = "SSE 通道不可用") {
    super(message)
    this.name = "SseUnavailableError"
  }
}

export interface ChatMessageRequest {
  sessionId?: string
  /** 前端生成 ULID（重试幂等，§9.1） */
  clientMessageId: string
  message: string
  /** 批B model_profile 就位前过渡：沿用凭据选择 */
  credentialId?: number
  model?: string
  attachments?: { kind: string; name: string; dataUrl?: string; fileId?: number }[]
}

/**
 * 发起流式对话：事件经 onEvent 逐个回调；Promise 在流正常读尽后 resolve。
 * 注意：message.failed 也是"正常的流事件"（由调用方转失败 UI），只有通道层异常才 reject。
 */
export async function streamChatMessage(req: ChatMessageRequest, onEvent: (evt: AiSseEvent) => void, signal?: AbortSignal): Promise<void> {
  const { token, offline } = useAuthStore.getState()
  let res: Response
  try {
    res = await fetch("/api/ai/chat/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token && !offline ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(req),
      signal,
    })
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err
    throw new NetworkError("无法连接后端服务")
  }

  if (res.status === 401) {
    useAuthStore.getState().logout()
    window.location.href = "/login"
    throw new ApiError(401, "登录已过期，请重新登录")
  }
  if (res.status === 404) throw new SseUnavailableError("流式端点未实现")

  const contentType = res.headers.get("content-type") ?? ""

  if (!res.ok || !contentType.includes("text/event-stream")) {
    // 后端以 JSON envelope 报业务错（409 忙 / 400 参数等）→ 按 ApiError 呈现，不回退
    try {
      const body = (await res.json()) as { code?: number; message?: string }
      if (body && (body.code !== undefined || body.message)) {
        throw new ApiError(typeof body.code === "number" && body.code !== 0 ? body.code : res.status, body.message ?? `请求失败（HTTP ${res.status}）`)
      }
    } catch (err) {
      if (err instanceof ApiError) throw err
      // 非 JSON（如网关 HTML 错误页）→ 通道不可用，走回退
    }
    throw new SseUnavailableError(`响应不是事件流（HTTP ${res.status}）`)
  }

  if (!res.body) throw new SseUnavailableError("响应无可读流")

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser((frame) => {
    const evt = parseAiEvent(frame)
    if (evt) onEvent(evt)
  })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
    }
    parser.feed(decoder.decode())
    parser.end()
  } finally {
    reader.releaseLock()
  }
}
