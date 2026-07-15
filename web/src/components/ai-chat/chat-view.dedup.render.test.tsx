// @vitest-environment jsdom
/**
 * 修「同一助手回复渲染两遍」冒烟：消息同时带 content 与同文 text part 时，正文只渲染一遍；
 * 不同文的 text part 或带引用的 text part 不受影响。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { AiMessage } from "./types"
import { ChatView } from "./chat-view"

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const baseProps = {
  sending: false,
  toolStatuses: [],
  sendError: null,
  offline: false,
  models: [],
  modelId: null,
  onModelChange: () => {},
  onSend: () => {},
  onRetry: () => {},
  onNewSession: () => {},
  briefing: null,
  onDismissBriefing: () => {},
  focusSignal: 0,
}

const renderView = (messages: AiMessage[]) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ChatView {...baseProps} messages={messages} />
      </TooltipProvider>
    </MemoryRouter>,
  )

const occurrences = (text: string, needle: string) => (text.match(new RegExp(needle, "g")) ?? []).length

describe("助手消息去重渲染", () => {
  it("content + 同文 text part → 正文只出现一次", () => {
    const { container } = renderView([
      {
        role: "ASSISTANT",
        content: "好的已处理完成",
        parts: [{ partId: "t1", partType: "text", schemaVersion: 1, sequenceNo: 1, payload: { text: "好的已处理完成" } }],
        createdAt: "2026-07-15T10:00:00",
      },
    ])
    expect(occurrences(container.textContent ?? "", "好的已处理完成")).toBe(1)
  })

  it("content + 不同文 text part → 两段都在（不误删）", () => {
    const { container } = renderView([
      {
        role: "ASSISTANT",
        content: "第一段正文AA",
        parts: [{ partId: "t2", partType: "text", schemaVersion: 1, sequenceNo: 1, payload: { text: "另一段补充BB" } }],
        createdAt: "2026-07-15T10:00:00",
      },
    ])
    const text = container.textContent ?? ""
    expect(text).toContain("第一段正文AA")
    expect(text).toContain("另一段补充BB")
  })
})
