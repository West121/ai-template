// @vitest-environment jsdom
/**
 * manage_form 卡冒烟（AI 受控管理操作，对齐后端批M1）：
 *  - 渲染 manage_prepare 表单卡（form-renderer + prefill）
 *  - 提交 → POST /api/ai/manage/submit **{actionCode, values, targetId}** → 换批A confirm 卡
 *  - .update 操作提交带 targetId
 *  - schema 非法 → 不白屏；后端未连接 → 演示确认卡降级
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import type { AiMessagePart } from "../protocol"
import { ManageFormPart } from "./manage-form-card"

beforeAll(() => {
  useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const part = (payload: Record<string, unknown>): AiMessagePart => ({ partId: "p1", partType: "manage_form", schemaVersion: 1, sequenceNo: 1, payload })

// 后端实况 schema 形状（无 id/width，type/key/label/required）
const SCHEMA = [
  { type: "input", key: "username", label: "用户名" },
  { type: "input", key: "name", label: "姓名" },
]

const renderPart = (payload: Record<string, unknown>) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ManageFormPart part={part(payload)} />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("manage_form 卡（受控管理操作）", () => {
  it("渲染管理表单：标题 + 管理操作徽标 + 字段 + 二次确认提示", () => {
    renderPart({ type: "manage_form", actionCode: "system.user.create", title: "新增用户", schema: SCHEMA, submitPath: "/api/ai/manage/submit" })
    expect(screen.getByText("新增用户")).toBeTruthy()
    expect(screen.getByText("管理操作")).toBeTruthy()
    expect(screen.getByText("用户名")).toBeTruthy()
    expect(screen.getByText(/提交后需二次确认/)).toBeTruthy()
  })

  it("提交 → POST /manage/submit {actionCode,values,targetId} → 换 confirm 卡", async () => {
    const calls: { url: string; body: string }[] = []
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") })
      const data = String(url).includes("/api/ai/manage/submit")
        ? { type: "confirm", actionId: 443, title: "确认新增用户：zhangsan", params: [{ label: "用户名", value: "zhangsan" }], danger: false }
        : {}
      return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
    })
    renderPart({ type: "manage_form", actionCode: "system.user.create", title: "新增用户", schema: SCHEMA, submitPath: "/api/ai/manage/submit" })
    fireEvent.click(screen.getByRole("button", { name: "提交" }))
    expect(await screen.findByText("确认新增用户：zhangsan")).toBeTruthy()
    expect(screen.getByText("需确认")).toBeTruthy()
    expect(screen.getByRole("button", { name: "确认" })).toBeTruthy()
    // 提交体：actionCode + values（后端字段名 values，非 formData）
    const submitCall = calls.find((c) => c.url.includes("/api/ai/manage/submit"))!
    expect(submitCall.body).toContain('"actionCode":"system.user.create"')
    expect(submitCall.body).toContain('"values"')
  })

  it(".update 操作：提交体带 targetId", async () => {
    const calls: { url: string; body: string }[] = []
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") })
      return { status: 200, json: async () => ({ code: 0, data: { type: "confirm", actionId: 9, title: "确认编辑用户" } }) } as unknown as Response
    })
    renderPart({ type: "manage_form", actionCode: "system.user.update", title: "编辑用户", schema: SCHEMA, targetId: "3", submitPath: "/api/ai/manage/submit" })
    fireEvent.click(screen.getByRole("button", { name: "提交" }))
    expect(await screen.findByText("确认编辑用户")).toBeTruthy()
    const submitCall = calls.find((c) => c.url.includes("/api/ai/manage/submit"))!
    expect(submitCall.body).toContain('"targetId":"3"')
  })

  it("schema 非法 → 提示不白屏", () => {
    renderPart({ type: "manage_form", actionCode: "x", title: "新增用户", schema: "not-a-schema" })
    expect(screen.getByText(/表单字段缺失/)).toBeTruthy()
  })
})
