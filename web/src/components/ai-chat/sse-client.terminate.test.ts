// @vitest-environment jsdom
/**
 * SSE 终止语义回归（用户实测：表单卡「取消」后输入框/发送按钮锁死）：
 * 根因——读循环只在连接关闭(reader done)才退出；后端发完 message.completed 若不立刻关流，
 * reader.read() 一直挂 → streamChatMessage 不 resolve → 本轮 sending 卡 true → 锁死。
 * 修复——收到 message.completed / message.failed 即停读 + 主动 cancel 流，使 Promise 及时 resolve。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { useAuthStore } from "@/stores/auth-store"
import { streamChatMessage } from "./sse-client"
import { sendChatStream } from "./api"

const enc = new TextEncoder()
const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`

/** 发完给定帧后**不关闭**连接（模拟后端 completed 后不立刻关流）；cancel 回调可观测主动取消 */
function completedThenHang(cancelSpy?: () => void) {
  const bytes = enc.encode(frame({ type: "message.started" }) + frame({ type: "message.completed", sessionId: 7 }))
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes)
      // 故意不 c.close()：后续 reader.read() 将永久挂起
    },
    cancel() {
      cancelSpy?.()
    },
  })
  return { status: 200, ok: true, headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null) }, body } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("streamChatMessage 终止事件即止（修锁死）", () => {
  it("completed 后连接不关：streamChatMessage 仍 resolve，且主动 cancel 流", async () => {
    useAuthStore.setState({ offline: false, token: "t" })
    const cancelSpy = vi.fn()
    vi.stubGlobal("fetch", async () => completedThenHang(cancelSpy))

    const types: string[] = []
    // 若未修复，此处会一直挂起直至 vitest 超时——resolve 即证明锁死已解
    await streamChatMessage({ clientMessageId: "m1", message: "帮我请10天年假" }, (e) => types.push(e.type))

    expect(types).toContain("message.completed")
    expect(cancelSpy).toHaveBeenCalled()
  })

  it("sendChatStream 在 completed-then-hang 下 resolve 为 mode=sse（sending 得以复位）", async () => {
    useAuthStore.setState({ offline: false, token: "t" })
    vi.stubGlobal("fetch", async () => completedThenHang())

    const out = await sendChatStream({ clientMessageId: "m2", message: "hi" }, {})
    expect(out.mode).toBe("sse")
    expect(out.sessionId).toBe("7") // sessionId 归一为字符串
  })

  it("abort signal 中止在途流：streamChatMessage 抛 AbortError（新一轮/卸载不泄漏）", async () => {
    useAuthStore.setState({ offline: false, token: "t" })
    const ac = new AbortController()
    // 永不产出、永不关闭的流；把 fetch 的 signal 接到流控制器上，abort 时 error 掉读端
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
      const body = new ReadableStream<Uint8Array>({ start(c) { ctrl = c } })
      init?.signal?.addEventListener("abort", () => {
        try { ctrl?.error(new DOMException("aborted", "AbortError")) } catch { /* noop */ }
      })
      return { status: 200, ok: true, headers: { get: () => "text/event-stream" }, body } as unknown as Response
    })

    const p = streamChatMessage({ clientMessageId: "m3", message: "hi" }, () => {}, ac.signal)
    ac.abort()
    await expect(p).rejects.toThrow()
  })
})
