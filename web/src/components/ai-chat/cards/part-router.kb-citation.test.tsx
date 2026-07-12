// @vitest-environment jsdom
/**
 * KB_DOC 引用角标渲染（§9.3）：AI 回答文本 part 的 citations 含 KB_DOC → 可点，跳
 * /knowledge/{spaceId}?doc={docId}；与 FEATURE/RAG_DOC 并存；无 spaceId 退回 /knowledge。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { PartRouter } from "./part-router"
import type { AiMessagePart } from "../protocol"

const navigate = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>()
  return { ...actual, useNavigate: () => navigate }
})
afterEach(() => {
  cleanup()
  navigate.mockClear()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const textPart = (citations: unknown[]): AiMessagePart => ({
  partId: "p1",
  partType: "text",
  schemaVersion: 1,
  sequenceNo: 1,
  payload: { text: "根据知识库，架构分四层。", citations },
})

const renderPart = (part: AiMessagePart) =>
  render(
    <MemoryRouter>
      <PartRouter part={part} />
    </MemoryRouter>,
  )

describe("KB_DOC 引用角标", () => {
  it("KB_DOC 引用可点 → 跳 /knowledge/{spaceId}?doc={docId}", () => {
    renderPart(textPart([{ sourceType: "KB_DOC", sourceId: "302", title: "代码提交规约", space: { id: 101, name: "产品研发知识库" } }]))
    const link = screen.getByRole("button", { name: /代码提交规约/ })
    fireEvent.click(link)
    expect(navigate).toHaveBeenCalledWith("/knowledge/101?doc=302")
  })

  it("KB_DOC 无 spaceId → 退回 /knowledge（仍可点，不白屏）", () => {
    renderPart(textPart([{ sourceType: "KB_DOC", sourceId: "999", title: "某知识文档" }]))
    fireEvent.click(screen.getByRole("button", { name: /某知识文档/ }))
    expect(navigate).toHaveBeenCalledWith("/knowledge")
  })

  it("与 RAG_DOC 并存：RAG_DOC 不可点（无路由）、KB_DOC 可点", () => {
    renderPart(
      textPart([
        { sourceType: "RAG_DOC", sourceId: "seed-1", title: "旧种子文档" },
        { sourceType: "KB_DOC", sourceId: "305", title: "知识库架构方案", spaceId: 101 },
      ]),
    )
    expect(screen.getByText("旧种子文档")).toBeTruthy() // 渲染但非按钮
    fireEvent.click(screen.getByRole("button", { name: /知识库架构方案/ }))
    expect(navigate).toHaveBeenCalledWith("/knowledge/101?doc=305")
  })
})
