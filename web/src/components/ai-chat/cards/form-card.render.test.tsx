// @vitest-environment jsdom
/**
 * FormCard 修复冒烟：① 预填 initialValues（"请10天年假"→字段已填）② 取消按钮本地收起。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { FormCard } from "./form-card"
import type { AiFormCard } from "../types"

afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const card: AiFormCard = {
  type: "form",
  defCode: "leave_flow",
  defName: "请假申请",
  formType: "ONLINE",
  schema: [
    { id: "w1", type: "number", label: "请假天数", key: "days", required: true, width: "half" },
    { id: "w2", type: "textarea", label: "请假事由", key: "reason", required: true, width: "full" },
  ] as never,
  prefill: { days: 10 },
}

const renderCard = (c: AiFormCard) =>
  render(
    <MemoryRouter>
      <FormCard card={c} />
    </MemoryRouter>,
  )

describe("FormCard 预填 + 取消", () => {
  it("prefill 透传 initialValues：请假天数预填 10", () => {
    renderCard(card)
    expect(screen.getByDisplayValue("10")).toBeTruthy()
  })

  it("prefill 非法形状（数组/字符串）→ 不预填、不崩", () => {
    renderCard({ ...card, prefill: ["boom"] as never })
    // 表单仍渲染（提交按钮在）
    expect(screen.getByText("提交并发起")).toBeTruthy()
  })

  it("点「取消」→ 本地收起表单，显示已取消（不提交）", () => {
    renderCard(card)
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(screen.getByText("已取消填写")).toBeTruthy()
    expect(screen.queryByText("提交并发起")).toBeNull()
  })
})
