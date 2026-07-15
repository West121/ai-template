// @vitest-environment jsdom
/** 组件示例 · 代码编辑器 demo 页冒烟：渲染不炸 + 挂出 CodeEditor。 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import CodeEditorDemoPage from "./code-editor"

beforeAll(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("代码编辑器 demo 页", () => {
  it("渲染标题 + CodeEditor，不白屏", () => {
    const { container } = render(
      <MemoryRouter>
        <TooltipProvider>
          <CodeEditorDemoPage />
        </TooltipProvider>
      </MemoryRouter>,
    )
    expect(screen.getByText("统一代码编辑器")).toBeTruthy()
    expect(container.querySelector(".cm-editor")).toBeTruthy()
  })
})
