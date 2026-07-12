// @vitest-environment jsdom
/**
 * 文档编辑器 × 协同 冒烟：mock useKbCollab 控制 connected/degraded。
 *  - degraded → 单人编辑器 + 「单人编辑」（红线：连不上仍可编、不白屏）
 *  - connected → 协同编辑器 + 在线状态条（N 人在线 + 头像）+ REST 正文播种进协同文档
 * 真实降级路径（jsdom 无 WS）另由 space-detail 冒烟覆盖。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import type { UseKbCollab } from "./use-kb-collab"
import { DocEditor } from "./doc-editor"

let collabReturn: UseKbCollab = { status: "degraded", users: [], extensions: null }
vi.mock("./use-kb-collab", async (orig) => {
  const actual = await orig<typeof import("./use-kb-collab")>()
  return { ...actual, useKbCollab: () => collabReturn }
})

beforeAll(() => {
  useAuthStore.setState({ offline: true, permissions: null, userId: null, token: null })
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})
vi.spyOn(console, "warn").mockImplementation(() => {})

const renderEditor = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <DocEditor docId={302} canEdit onDocChanged={() => {}} />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("DocEditor × 协同", () => {
  it("degraded → 单人编辑，正文可见（红线：连不上仍可编）", async () => {
    collabReturn = { status: "degraded", users: [], extensions: null }
    renderEditor()
    expect(await screen.findByDisplayValue("代码提交规约")).toBeTruthy()
    expect(screen.getByText("单人编辑")).toBeTruthy()
    expect(await screen.findByText(/为保证协作质量/)).toBeTruthy()
  })

  it("connected → 协同编辑 + 在线状态条 + REST 正文播种", async () => {
    collabReturn = {
      status: "connected",
      users: [
        { clientId: 1, name: "张三", color: "#f97316" },
        { clientId: 2, name: "李四", color: "#0ea5e9" },
      ],
      extensions: [],
    }
    renderEditor()
    expect(await screen.findByText(/协同编辑 · 2 人在线/)).toBeTruthy()
    expect(screen.getByTitle("张三")).toBeTruthy()
    // 协同文档从空播种 REST 正文
    expect(await screen.findByText(/为保证协作质量/)).toBeTruthy()
  })
})
