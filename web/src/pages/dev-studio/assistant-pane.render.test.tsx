// @vitest-environment jsdom
/**
 * Dev Studio 右栏 AI 助手 冒烟（批W2）：渲染（空态引导/当前资产标注）+ 发送带
 * pageContext {featureCode:"dev-studio", entityType:资产type, entityId:code}。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import { DevStudioAssistantPane } from "./assistant-pane"

const sendChatStream = vi.hoisted(() =>
  vi.fn(async (_req: { pageContext?: unknown }, h: { onStarted?: () => void; onTextDelta?: (t: string) => void }) => {
    h.onStarted?.()
    h.onTextDelta?.("好的")
    return { sessionId: "s1", demo: false, mode: "sse" as const }
  }),
)
vi.mock("@/components/ai-chat/api", async (orig) => {
  const actual = await orig<typeof import("@/components/ai-chat/api")>()
  return { ...actual, sendChatStream }
})

beforeAll(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  useAuthStore.setState({ offline: false, permissions: null, token: "t" })
})
afterEach(() => {
  cleanup()
  sendChatStream.mockClear()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const renderPane = (asset: { type: "PROCESS"; code: string; name: string } | null) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <DevStudioAssistantPane asset={asset} />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("Dev Studio 右栏 AI 助手", () => {
  it("渲染：空态引导（示例指令）+ 当前资产标注", () => {
    renderPane({ type: "PROCESS", code: "leave_approval", name: "请假审批" })
    expect(screen.getByText(/AI 改写/)).toBeTruthy()
    expect(screen.getByText(/当前资产：请假审批（leave_approval）/)).toBeTruthy()
    expect(screen.getByText(/把请假流程的天数阈值改成 5/)).toBeTruthy()
  })

  it("未选资产 → 引导先选资产", () => {
    renderPane(null)
    expect(screen.getByText(/先在左侧选中一个资产/)).toBeTruthy()
  })

  it("发送 → pageContext {featureCode:dev-studio, entityType, entityId}", async () => {
    renderPane({ type: "PROCESS", code: "leave_approval", name: "请假审批" })
    const user = userEvent.setup()
    const input = screen.getByPlaceholderText(/问问星辰助手/)
    await user.type(input, "把天数阈值改成 5{Enter}")
    await waitFor(() => expect(sendChatStream).toHaveBeenCalledTimes(1))
    const req = sendChatStream.mock.calls[0][0] as { message: string; pageContext?: unknown }
    expect(req.message).toContain("把天数阈值改成 5")
    expect(req.pageContext).toEqual({ featureCode: "dev-studio", entityType: "PROCESS", entityId: "leave_approval" })
  })
})
