// @vitest-environment jsdom
/**
 * 空间内页 反白屏冒烟：offline 演示 → 左目录树（FOLDER/DOC）+ 右文档编辑器（TipTap，复用 rich-text）。
 * 首个文档默认选中并进编辑器；ADMIN（offline 放开）→ 可编。renders without throwing。
 * jsdom 需 ProseMirror rect polyfill + TooltipProvider（生产由 App.tsx 提供）。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import SpaceDetail from "./space-detail"

beforeAll(() => {
  useAuthStore.setState({ offline: true, permissions: null, userId: null, token: null })
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} }
  // ProseMirror 在 jsdom 需要 Range 几何（否则 EditorView 抛错）
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})
vi.spyOn(console, "warn").mockImplementation(() => {})

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/knowledge/101"]}>
      <TooltipProvider>
        <Routes>
          <Route path="/knowledge/:spaceId" element={<SpaceDetail />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("知识库 空间内页", () => {
  it("左目录树 + 右文档编辑：空间名/树节点/首文档进编辑器，反白屏", async () => {
    renderPage()
    // 头部空间名
    expect(await screen.findByText("产品研发知识库")).toBeTruthy()
    // 目录树：目录 + 文档节点（默认展开）
    expect(await screen.findByText("研发规范")).toBeTruthy()
    expect(screen.getByText("接口设计规范")).toBeTruthy()
    // 首个文档默认选中 → 编辑器标题输入（可编，ADMIN）
    expect(await screen.findByDisplayValue("代码提交规约")).toBeTruthy()
    // 成员入口 + 演示提示
    expect(screen.getByRole("button", { name: /成员/ })).toBeTruthy()
    expect(screen.getAllByText(/演示数据/).length).toBeGreaterThan(0)
  })

  it("文档正文经 codec 载入编辑器（renders without throwing）", async () => {
    renderPage()
    // 首文档正文文本（TipTap 渲染进 DOM）
    expect(await screen.findByText(/为保证协作质量/)).toBeTruthy()
  })
})
