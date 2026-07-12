// @vitest-environment jsdom
/**
 * ChatView × 「思考中」折叠态集成冒烟：消除双重噪音 + 完成后可回看。
 *  - 流式有工具 → 只一个 active ThinkingBlock（呼吸头），不再叠 TypingIndicator（三点）
 *  - 流式无工具（纯思考）→ TypingIndicator 三点
 *  - 助手消息带 thinking → 完成态一行「已完成 · N 步」
 */
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ChatView } from "./chat-view"
import type { AiMessage } from "./types"
import type { ToolStatusItem } from "./api"

afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const baseProps = {
  messages: [] as AiMessage[],
  sending: false,
  toolStatuses: [] as ToolStatusItem[],
  sendError: null,
  offline: false,
  models: [],
  modelId: null,
  onModelChange: () => {},
  onSend: () => {},
  onRetry: () => {},
  onNewSession: () => {},
  focusSignal: 0,
}

const ChatViewAny = ChatView as unknown as (p: Record<string, unknown>) => ReactNode
const renderChat = (over: Record<string, unknown>) =>
  render(
    <MemoryRouter>
      <ChatViewAny {...baseProps} {...over} />
    </MemoryRouter>,
  )

describe("ChatView 思考态集成", () => {
  it("流式有工具 → 只一个思考块，无三点 TypingIndicator（消除双重噪音）", () => {
    renderChat({
      messages: [{ role: "ASSISTANT", content: "" }],
      sending: true,
      toolStatuses: [{ id: "1", displayName: "正在生成统计数据", state: "running" }],
    })
    // 呼吸头显当前步
    expect(screen.getByText("正在生成统计数据")).toBeTruthy()
    // 不再有打字三点
    expect(screen.queryByLabelText("助手正在输入")).toBeNull()
  })

  it("流式无工具（纯思考）→ TypingIndicator 三点", () => {
    renderChat({ messages: [{ role: "ASSISTANT", content: "" }], sending: true, toolStatuses: [] })
    expect(screen.getByLabelText("助手正在输入")).toBeTruthy()
  })

  it("助手消息带 thinking → 完成态一行「已完成 · N 步」", () => {
    const msg: AiMessage = {
      role: "ASSISTANT",
      content: "统计完成",
      thinking: [
        { id: "1", displayName: "查报表A", state: "done" },
        { id: "2", displayName: "查报表B", state: "done" },
      ],
    }
    renderChat({ messages: [msg], sending: false })
    expect(screen.getByText(/已完成 · 2 步/)).toBeTruthy()
    expect(screen.getByText("统计完成")).toBeTruthy()
  })

  it("纯文本直答（无 thinking）→ 不留思考块", () => {
    renderChat({ messages: [{ role: "ASSISTANT", content: "你好" }], sending: false })
    expect(screen.queryByText(/已完成 ·/)).toBeNull()
    expect(screen.getByText("你好")).toBeTruthy()
  })
})
