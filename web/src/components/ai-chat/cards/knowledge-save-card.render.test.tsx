// @vitest-environment jsdom
/**
 * 对话固化确认卡 冒烟：选目标空间（可见可编）+ 标题 → 确认 → 调 confirmActionV2({spaceId,title}) → 已存草稿。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useAuthStore } from "@/stores/auth-store"
import { useAiActionOutcomes } from "@/stores/ai-action-outcomes"
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
  useAiActionOutcomes.getState().clear() // 隔离：结果 store 为模块单例，跨用例清空
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

  it("取消后「重挂」(关面板重开)仍显示已取消，不复活为可操作表单", async () => {
    const { unmount } = renderCard({ actionId: "act-3", title: "临时", defaultSpaceId: 101 })
    await waitFor(() => expect((screen.getByRole("button", { name: /确认（建草稿）/ }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(await screen.findByText("已取消")).toBeTruthy()
    unmount() // 关闭 AI 面板 → 卡组件卸载
    renderCard({ actionId: "act-3", title: "临时", defaultSpaceId: 101 }) // 重开 → 卡重挂
    expect(await screen.findByText("已取消")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /确认（建草稿）/ })).toBeNull() // 不复活
  })

  it("确认后「重挂」仍显示已完成，不复活", async () => {
    const { unmount } = renderCard({ actionId: "act-4", title: "会议纪要", defaultSpaceId: 101 })
    const btn = screen.getByRole("button", { name: /确认（建草稿）/ })
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(btn)
    expect(await screen.findByText(/已存为草稿/)).toBeTruthy()
    unmount()
    renderCard({ actionId: "act-4", title: "会议纪要", defaultSpaceId: 101 })
    expect(await screen.findByText(/已存为草稿/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /确认（建草稿）/ })).toBeNull()
  })
})
