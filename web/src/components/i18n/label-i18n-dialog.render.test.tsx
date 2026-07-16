// @vitest-environment jsdom
/**
 * 多语言编辑弹窗冒烟（i18n M1）：
 *  - 触发钮 → 弹窗：源文（简中）只读 + 四行译文输入
 *  - 手填 EN → 保存 → onChange 收到 {en}（空行剔除；全空 → undefined）
 *  - AI 翻译（offline → mock 伪译文）默认只回填空行
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import { compactLabelI18n, LabelI18nButton } from "./label-i18n-dialog"

beforeAll(() => {
  useAuthStore.setState({ offline: true, token: null, permissions: null }) // AI 翻译走 mock
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("compactLabelI18n", () => {
  it("剔除空串/空白；全空 → undefined", () => {
    expect(compactLabelI18n({ en: " Days ", "zh-TW": "", th: "  ", ja: "" })).toEqual({ en: "Days" })
    expect(compactLabelI18n({ en: "", "zh-TW": "", th: "", ja: "" })).toBeUndefined()
  })
})

describe("LabelI18nButton / Dialog", () => {
  it("打开弹窗：源文只读回显 + 手填 EN → 保存 → onChange({en})", async () => {
    const onChange = vi.fn()
    render(
      <TooltipProvider>
        <LabelI18nButton source="请假天数" value={undefined} onChange={onChange} />
      </TooltipProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "多语言" }))
    expect(await screen.findByText("多语言文案")).toBeTruthy()
    // 源文只读
    const source = screen.getByDisplayValue("请假天数") as HTMLInputElement
    expect(source.readOnly || source.disabled).toBe(true)
    // 手填 English，其余留空
    await user.type(screen.getByRole("textbox", { name: "English 译文" }), "Days of Leave")
    await user.click(screen.getByRole("button", { name: "保存" }))
    expect(onChange).toHaveBeenCalledWith({ en: "Days of Leave" })
  })

  it("AI 翻译（offline mock）默认只回填空行，已填不覆盖", async () => {
    const onChange = vi.fn()
    render(
      <TooltipProvider>
        <LabelI18nButton source="请假天数" value={{ ja: "手填日文" }} onChange={onChange} />
      </TooltipProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "多语言" }))
    await screen.findByText("多语言文案")
    await user.click(screen.getByRole("button", { name: /AI 翻译/ }))
    // mock 伪译文回填空行（[EN]/[繁]/[TH] 前缀），ja 已填保持
    await waitFor(() => {
      expect((screen.getByRole("textbox", { name: "English 译文" }) as HTMLInputElement).value).toBe("[EN] 请假天数")
    })
    expect((screen.getByRole("textbox", { name: "繁體中文 译文" }) as HTMLInputElement).value).toBe("[繁] 请假天数")
    expect((screen.getByRole("textbox", { name: "ไทย 译文" }) as HTMLInputElement).value).toBe("[TH] 请假天数")
    expect((screen.getByRole("textbox", { name: "日本語 译文" }) as HTMLInputElement).value).toBe("手填日文")
    // 保存 → mock 译文入 labelI18n
    await user.click(screen.getByRole("button", { name: "保存" }))
    expect(onChange).toHaveBeenCalledWith({
      en: "[EN] 请假天数",
      "zh-TW": "[繁] 请假天数",
      th: "[TH] 请假天数",
      ja: "手填日文",
    })
  })

  it("已配置语言时触发钮带圆点角标", async () => {
    render(
      <TooltipProvider>
        <LabelI18nButton source="请假天数" value={{ en: "Days" }} onChange={() => undefined} />
      </TooltipProvider>,
    )
    const btn = screen.getByRole("button", { name: "多语言" })
    expect(btn.querySelector("span.bg-primary")).toBeTruthy()
  })
})
