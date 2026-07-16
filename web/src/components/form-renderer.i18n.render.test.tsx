// @vitest-environment jsdom
/**
 * FormRenderer 按 locale 渲染 label（i18n M1）：
 *  - locale=en：labelI18n.en 命中 → 英文；缺翻字段回退中文
 *  - locale=zh-CN（缺省）：labelI18n 存在也渲染中文源（零变化红线）
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { useAppStore } from "@/stores/app-store"
import type { FormWidget } from "@/types/workflow"
import { FormRenderer } from "./form-renderer"

const WIDGETS: FormWidget[] = [
  { id: "days", key: "days", type: "input", label: "请假天数", labelI18n: { en: "Days of Leave" } },
  { id: "reason", key: "reason", type: "input", label: "请假事由" }, // 无 labelI18n → 恒中文
]

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => {
  cleanup()
  useAppStore.setState({ locale: "zh-CN" })
})
vi.spyOn(console, "error").mockImplementation(() => {})

describe("FormRenderer × locale", () => {
  it("locale=en → labelI18n 命中英文、缺翻回退中文", () => {
    useAppStore.setState({ locale: "en" })
    render(<FormRenderer widgets={WIDGETS} onSubmit={() => undefined} />)
    expect(screen.getByText("Days of Leave")).toBeTruthy()
    expect(screen.queryByText("请假天数")).toBeNull()
    expect(screen.getByText("请假事由")).toBeTruthy()
  })

  it("locale=zh-CN（缺省）→ 全中文，零变化", () => {
    render(<FormRenderer widgets={WIDGETS} onSubmit={() => undefined} />)
    expect(screen.getByText("请假天数")).toBeTruthy()
    expect(screen.queryByText("Days of Leave")).toBeNull()
  })
})
