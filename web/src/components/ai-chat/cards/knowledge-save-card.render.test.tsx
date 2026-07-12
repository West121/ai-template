// @vitest-environment jsdom
/**
 * 对话固化确认卡 冒烟：选目标空间（可见可编）+ 标题 → 确认 → 调 confirmActionV2({spaceId,title}) → 已存草稿。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useAuthStore } from "@/stores/auth-store"
import type { AiMessagePart } from "../protocol"
import { KnowledgeSavePart } from "./knowledge-save-card"

const confirmActionV2 = vi.hoisted(() => vi.fn(async (_actionId: string, _key: string, _params?: Record<string, unknown>) => ({ data: { ok: true }, demo: true })))
const cancelActionV2 = vi.hoisted(() => vi.fn(async (_actionId: string) => undefined))
vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>()
  return { ...actual, confirmActionV2, cancelActionV2 }
})

beforeAll(() => {
  useAuthStore.setState({ offline: true, permissions: null, userId: null, token: null })
})
afterEach(() => {
  cleanup()
  confirmActionV2.mockClear()
  cancelActionV2.mockClear()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const part = (payload: Record<string, unknown>): AiMessagePart => ({ partId: "p1", partType: "knowledgeSave", schemaVersion: 1, sequenceNo: 1, payload })

const renderCard = (payload: Record<string, unknown>) =>
  render(
    <MemoryRouter>
      <KnowledgeSavePart part={part(payload)} />
    </MemoryRouter>,
  )

describe("对话固化确认卡", () => {
  it("选空间 + 标题 → 确认 → confirmActionV2({spaceId,title}) → 已存草稿", async () => {
    renderCard({ actionId: "act-1", title: "会议纪要", contentPreview: "这是要固化的会议要点", defaultSpaceId: 101 })
    // 内容预览 + 标题预填 + 目标空间下拉
    expect(screen.getByText("这是要固化的会议要点")).toBeTruthy()
    expect((screen.getByLabelText("文档标题") as HTMLInputElement).value).toBe("会议纪要")
    expect(screen.getByLabelText("目标空间")).toBeTruthy()
    // 等空间加载完成（默认 101 可编）后确认
    const btn = screen.getByRole("button", { name: /确认（建草稿）/ })
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(btn)
    await waitFor(() => expect(confirmActionV2).toHaveBeenCalledTimes(1))
    expect(confirmActionV2.mock.calls[0][0]).toBe("act-1")
    expect(confirmActionV2.mock.calls[0][2]).toEqual({ spaceId: 101, title: "会议纪要" })
    // 成功态
    expect(await screen.findByText(/已存为草稿/)).toBeTruthy()
    expect(screen.getByRole("button", { name: /查看文档/ })).toBeTruthy()
  })

  it("取消 → cancelActionV2 + 已取消", async () => {
    renderCard({ actionId: "act-2", title: "临时", defaultSpaceId: 101 })
    await waitFor(() => expect((screen.getByRole("button", { name: /确认（建草稿）/ }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(cancelActionV2).toHaveBeenCalledWith("act-2")
    expect(await screen.findByText("已取消")).toBeTruthy()
  })
})
