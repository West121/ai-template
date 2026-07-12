// @vitest-environment jsdom
/**
 * 管理操作快捷入口 chips 冒烟（管理框架M1，可发现性）：
 *  - 带 manageActions 的 list 卡 → 渲染可点 chip（label）
 *  - 点击 chip → POST /api/ai/manage/prepare {actionCode} → appendAssistantParts 挂 manage_form 卡
 *  - manageActions 空/非数组 → 走普通 list 渲染，不出 chips（不崩）
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useAuthStore } from "@/stores/auth-store"
import { AiChatActionsContext } from "../chat-actions"
import type { AiListCard } from "../types"
import { ListCard } from "./list-card"

beforeAll(() => {
  useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
})
const append = vi.fn()
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  append.mockClear()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const manageCard: AiListCard = {
  type: "list",
  title: "我可以帮你做的管理操作",
  columns: [{ key: "label", label: "操作" }],
  rows: [],
  manageActions: [
    { actionCode: "system.user.create", label: "新增用户", module: "system", entityLabel: "用户", action: "CREATE" },
    { actionCode: "system.dept.update", label: "编辑部门", module: "system", entityLabel: "部门", action: "UPDATE" },
  ],
}

const renderCard = (card: AiListCard) =>
  render(
    <MemoryRouter>
      <AiChatActionsContext.Provider value={{ appendAssistantParts: append }}>
        <ListCard card={card} />
      </AiChatActionsContext.Provider>
    </MemoryRouter>,
  )

describe("管理操作快捷入口 chips", () => {
  it("带 manageActions → 渲染可点 chips + 引导", () => {
    renderCard(manageCard)
    expect(screen.getByText("新增用户")).toBeTruthy()
    expect(screen.getByText("编辑部门")).toBeTruthy()
    expect(screen.getByText(/我可以帮你做的管理操作/)).toBeTruthy()
    expect(screen.getByText(/提交后需二次确认/)).toBeTruthy()
  })

  it("点击 chip → POST /manage/prepare {actionCode} → append manage_form 卡", async () => {
    const calls: { url: string; body: string }[] = []
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") })
      return {
        status: 200,
        json: async () => ({ code: 0, data: { type: "manage_form", actionCode: "system.user.create", title: "新增用户", schema: [{ type: "input", key: "username", label: "用户名" }], submitPath: "/api/ai/manage/submit" } }),
      } as unknown as Response
    })
    renderCard(manageCard)
    fireEvent.click(screen.getByText("新增用户"))
    await waitFor(() => expect(append).toHaveBeenCalled())
    const prep = calls.find((c) => c.url.includes("/api/ai/manage/prepare"))!
    expect(prep.body).toContain('"actionCode":"system.user.create"')
    // 追加的是 manage_form part（与 LLM 驱动同一渲染）
    const parts = append.mock.calls[0][1] as { partType: string; payload: { actionCode?: string } }[]
    expect(parts[0].partType).toBe("manage_form")
    expect(parts[0].payload.actionCode).toBe("system.user.create")
  })

  it("manageActions 空 → 普通 list 渲染，不出 chips（防白屏）", () => {
    render(
      <MemoryRouter>
        <ListCard card={{ ...manageCard, manageActions: [], rows: [{ label: "普通行X" }] }} />
      </MemoryRouter>,
    )
    expect(screen.getByText("普通行X")).toBeTruthy()
    expect(screen.queryByText("编辑部门")).toBeNull()
  })
})
