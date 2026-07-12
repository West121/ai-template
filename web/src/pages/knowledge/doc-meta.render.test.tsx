// @vitest-environment jsdom
/** 文档 AI 元信息 冒烟：AI 摘要卡（标 AI 生成）+ 标签 chips（AI/手动区分）；空则不渲染。 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { DocMeta } from "./doc-meta"

afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("DocMeta", () => {
  it("有摘要 + AI/手动标签 → 全部渲染，AI 标签标注来源", () => {
    render(
      <DocMeta
        summary="本文约定代码提交规约与分支模型。"
        tags={[
          { id: 1, name: "研发规范", source: "MANUAL" },
          { id: 2, name: "代码提交", source: "AI" },
        ]}
      />,
    )
    expect(screen.getByText("AI 摘要")).toBeTruthy()
    expect(screen.getByText("AI 生成")).toBeTruthy()
    expect(screen.getByText("本文约定代码提交规约与分支模型。")).toBeTruthy()
    expect(screen.getByText("研发规范")).toBeTruthy()
    expect(screen.getByText("代码提交")).toBeTruthy()
  })

  it("无摘要 + 无标签 → 不渲染（空态不占位）", () => {
    const { container } = render(<DocMeta summary="" tags={[]} />)
    expect(container.textContent).toBe("")
  })

  it("仅标签无摘要 → 只出标签，不出摘要卡", () => {
    render(<DocMeta tags={[{ id: 9, name: "制度", source: "AI" }]} />)
    expect(screen.queryByText("AI 摘要")).toBeNull()
    expect(screen.getByText("制度")).toBeTruthy()
  })
})
