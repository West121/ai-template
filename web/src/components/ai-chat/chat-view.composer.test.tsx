// @vitest-environment jsdom
/**
 * ChatView 一体化输入卡（丹青 ai-composer）渲染冒烟：
 *  - 三态：空(发送 disabled) / 输入中(发送亮) / 发送中(发送中 + 全禁用 Loader2)
 *  - 一体化卡：附件/输入/工具栏三层同卡；模型器移入工具栏右侧(👁 前缀)
 *  - 拖拽：拖到卡 → data-dragging + "松开以添加附件"覆盖层 → 离开消失
 *  - 拖拽/粘贴入库：都走 ingestFiles → checkAttachmentFile → uploadAttachment（零新校验）
 *  - 核心操作(附件/发送)始终在 DOM（不随窄屏收起）
 */
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ChatView } from "./chat-view"

const uploadAttachment = vi.hoisted(() => vi.fn(async () => ({ data: { attachmentId: "a1", url: "http://x/a1.png" } })))
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>()
  return { ...actual, uploadAttachment }
})

afterEach(() => {
  cleanup()
  uploadAttachment.mockClear()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const baseProps = {
  messages: [],
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
  focusSignal: 0,
}
const ChatViewAny = ChatView as unknown as (p: Record<string, unknown>) => ReactNode
const renderChat = (over: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <ChatViewAny {...baseProps} {...over} />
    </MemoryRouter>,
  )
const pngFile = () => new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" })

describe("ChatView 一体化输入卡", () => {
  it("空态：一体化卡 + 发送键 disabled + 核心操作(附件/发送)在", () => {
    renderChat()
    expect(screen.getByRole("group", { name: "消息输入" })).toBeTruthy()
    expect(screen.getByPlaceholderText(/问问星辰助手/)).toBeTruthy()
    // 唯一实心强调=发送键，空态 disabled
    const send = screen.getByRole("button", { name: "发送" }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    // 核心操作始终在
    expect(screen.getByRole("button", { name: /添加附件/ })).toBeTruthy()
  })

  it("输入中：有文本 → 发送键亮（可点）", () => {
    renderChat()
    fireEvent.change(screen.getByPlaceholderText(/问问星辰助手/), { target: { value: "你好" } })
    expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("发送中：发送键转「发送中」并禁用 + 附件按钮禁用", () => {
    renderChat({ sending: true, messages: [{ role: "USER", content: "在" }] })
    expect((screen.getByRole("button", { name: "发送中" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: /添加附件/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("模型器移入工具栏右侧：👁 支持视觉前缀渲染", () => {
    renderChat({ models: [{ id: "m1", name: "GPT-4V", description: "视觉", supportsVision: true }], modelId: "m1" })
    expect(screen.getByRole("combobox")).toBeTruthy() // 精简模型 chip 在卡内
    expect(screen.getAllByLabelText("支持视觉").length).toBeGreaterThan(0) // 👁
  })

  it("拖拽：拖到卡显覆盖层，离开消失", () => {
    renderChat()
    const card = screen.getByRole("group", { name: "消息输入" })
    fireEvent.dragOver(card, { dataTransfer: { types: ["Files"], files: [] } })
    expect(card.getAttribute("data-dragging")).toBe("true")
    expect(screen.getByText("松开以添加附件")).toBeTruthy()
    fireEvent.dragLeave(card, { relatedTarget: null })
    expect(card.getAttribute("data-dragging")).toBeNull()
    expect(screen.queryByText("松开以添加附件")).toBeNull()
  })

  it("拖拽落图 → 走 ingestFiles 校验并上传（复用现校验，零新逻辑）", async () => {
    renderChat()
    const card = screen.getByRole("group", { name: "消息输入" })
    fireEvent.drop(card, { dataTransfer: { files: [pngFile()], types: ["Files"] } })
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1))
  })

  it("粘贴图片 → 进附件（走 ingestFiles）；无图片不拦截", async () => {
    renderChat()
    const ta = screen.getByPlaceholderText(/问问星辰助手/)
    fireEvent.paste(ta, { clipboardData: { files: [pngFile()] } })
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1))
    // 纯文本粘贴（无文件）不触发入库
    fireEvent.paste(ta, { clipboardData: { files: [] } })
    expect(uploadAttachment).toHaveBeenCalledTimes(1)
  })
})
