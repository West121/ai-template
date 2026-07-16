// @vitest-environment jsdom
/**
 * devDiff 卡 冒烟（批W2）：
 *  - 行级 diff 渲染（add/del）+ 未变段折叠（±3 上下文）+ 展开全部
 *  - 确认 → confirmActionV2(actionId, Idempotency-Key) + 成功态（在工作台查看）+ 广播 asset-changed
 *  - 执行失败（ok:false，资产被改）→ 失败态 message + 重新发起提示
 *  - 取消后「重挂」不复活（ai-action-outcomes）
 *  - oldContent/newContent 非串容错；protocol 白名单解析 ok
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useAuthStore } from "@/stores/auth-store"
import { useAiActionOutcomes } from "@/stores/ai-action-outcomes"
import { resolvePart, type AiMessagePart } from "../protocol"
import { DevDiffPart } from "./dev-diff-card"

interface MockActionResult {
  ok: boolean
  message?: string
  resultLink?: string
  expired?: boolean
}
const confirmActionV2 = vi.hoisted(() =>
  vi.fn(async (_actionId: string, _key: string): Promise<{ data: MockActionResult; demo: boolean }> => ({
    data: { ok: true, message: "已应用并发布 v5", resultLink: "/dev-studio" },
    demo: false,
  })),
)
const cancelActionV2 = vi.hoisted(() => vi.fn(async (_actionId: string) => undefined))
vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>()
  return { ...actual, confirmActionV2, cancelActionV2 }
})

beforeAll(() => {
  useAuthStore.setState({ offline: false, permissions: null, token: "t" })
})
afterEach(() => {
  cleanup()
  confirmActionV2.mockClear()
  cancelActionV2.mockClear()
  confirmActionV2.mockImplementation(async () => ({ data: { ok: true, message: "已应用并发布 v5", resultLink: "/dev-studio" }, demo: false }))
  useAiActionOutcomes.getState().clear()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const pad = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `"${prefix}${i}": ${i}`).join(",\n")
const OLD = `{\n${pad("a", 10)},\n"threshold": 3,\n${pad("b", 10)}\n}`
const NEW = OLD.replace('"threshold": 3', '"threshold": 5')

const part = (payload: Record<string, unknown>): AiMessagePart => ({ partId: "pd1", partType: "devDiff", schemaVersion: 1, sequenceNo: 1, payload })

const basePayload = {
  actionId: "act-dev-1",
  assetType: "PROCESS",
  code: "leave_approval",
  name: "请假审批",
  oldContent: OLD,
  newContent: NEW,
  summary: "审批天数阈值 3 → 5",
  baseVersion: 4,
  publish: true,
}

const renderCard = (payload: Record<string, unknown> = basePayload) =>
  render(
    <MemoryRouter>
      <DevDiffPart part={part(payload)} />
    </MemoryRouter>,
  )

describe("devDiff 卡", () => {
  it("protocol 白名单：devDiff 解析 ok（未知类型仍降级）", () => {
    expect(resolvePart({ partType: "devDiff", schemaVersion: 1, payload: {} })).toEqual({ status: "ok", type: "devDiff" })
    expect(resolvePart({ partType: "devNope", schemaVersion: 1, payload: {} }).status).toBe("degraded")
  })

  it("diff 渲染：add/del 行 + 未变段折叠 + 展开全部", async () => {
    renderCard()
    expect(screen.getByText(/变更提案 · 请假审批/)).toBeTruthy()
    expect(screen.getByText(/审批天数阈值 3 → 5/)).toBeTruthy()
    expect(screen.getByText(/- "threshold": 3/)).toBeTruthy()
    expect(screen.getByText(/\+ "threshold": 5/)).toBeTruthy()
    // 未变段折叠（首段 head=0 tail=3 → 折叠 8 行；尾段对称）
    const folds = screen.getAllByText(/折叠 \d+ 行未变/)
    expect(folds.length).toBeGreaterThan(0)
    expect(screen.queryByText(/"a0": 0/)).toBeNull() // 折叠中段不渲染
    fireEvent.click(folds[0])
    expect(await screen.findByText(/"a0": 0/)).toBeTruthy() // 展开全部
    expect(screen.queryByText(/折叠 \d+ 行未变/)).toBeNull()
    // publish=true → 发布生效提示 + destructive 键
    expect(screen.getByText(/立即对新发起\/新触发生效/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "确认并发布" })).toBeTruthy()
  })

  it("确认 → confirmActionV2(actionId, Idempotency-Key) → 成功态 + 广播 asset-changed", async () => {
    const changed = vi.fn()
    window.addEventListener("dev-studio:asset-changed", changed)
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: "确认并发布" }))
    await waitFor(() => expect(confirmActionV2).toHaveBeenCalledTimes(1))
    expect(confirmActionV2.mock.calls[0][0]).toBe("act-dev-1")
    expect(String(confirmActionV2.mock.calls[0][1])).toMatch(/^[0-9A-Z]{26}$/) // ULID Idempotency-Key
    expect(await screen.findByText("已应用并发布 v5")).toBeTruthy()
    expect(screen.getByRole("button", { name: /在工作台查看/ })).toBeTruthy()
    expect(changed).toHaveBeenCalledTimes(1)
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ assetType: "PROCESS", code: "leave_approval" })
    window.removeEventListener("dev-studio:asset-changed", changed)
  })

  it("执行失败（资产被改，ok:false）→ 失败态 message + 重新发起提示", async () => {
    confirmActionV2.mockImplementation(async () => ({ data: { ok: false, message: "资产已被修改，请重新发起" }, demo: false }))
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: "确认并发布" }))
    expect(await screen.findByText(/资产已被修改，请重新发起/)).toBeTruthy()
    expect(screen.getByText(/重新描述需求发起新提案/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "确认并发布" })).toBeNull() // 终态不可再点
  })

  it("取消后「重挂」（关面板重开）仍显示已取消，不复活", async () => {
    const { unmount } = renderCard()
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(await screen.findByText("已取消")).toBeTruthy()
    expect(cancelActionV2).toHaveBeenCalledWith("act-dev-1")
    unmount()
    renderCard()
    expect(await screen.findByText("已取消")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "确认并发布" })).toBeNull()
  })

  it("oldContent/newContent 非串（对象/null）→ 容错不炸", () => {
    renderCard({ ...basePayload, oldContent: { a: 1 } as unknown, newContent: null as unknown })
    expect(screen.getByText(/变更提案/)).toBeTruthy()
  })

  it("publish=false → 中性提示「仅保存为草稿」+ 确认改写", () => {
    renderCard({ ...basePayload, publish: false })
    expect(screen.getByText(/仅保存为草稿/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "确认改写" })).toBeTruthy()
  })
})
