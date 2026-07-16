// @vitest-environment jsdom
/**
 * 顶栏语言切换器冒烟（i18n M1）：
 *  - 五语母语自显（简体中文/English/繁體中文/ไทย/日本語）
 *  - 点击 → app-store.locale 更新 + i18next.changeLanguage 联动（lib/i18n 订阅）
 *  - persist：oa-app-settings 落 localStorage
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/stores/app-store"
import i18n from "@/lib/i18n" // 触发初始化 + locale 订阅联动
import { LocaleSwitcher } from "./locale-switcher"

beforeAll(() => {
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
afterEach(() => {
  cleanup()
  useAppStore.setState({ locale: "zh-CN" })
})

const renderSwitcher = () =>
  render(
    <TooltipProvider>
      <LocaleSwitcher />
    </TooltipProvider>,
  )

describe("语言切换器", () => {
  it("下拉五项母语自显", async () => {
    renderSwitcher()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "切换语言" }))
    for (const native of ["简体中文", "English", "繁體中文", "ไทย", "日本語"]) {
      expect(await screen.findByText(native)).toBeTruthy()
    }
  })

  it("点击日本語 → locale=ja + i18next 联动 + persist", async () => {
    renderSwitcher()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "切换语言" }))
    await user.click(await screen.findByText("日本語"))

    expect(useAppStore.getState().locale).toBe("ja")
    // lib/i18n 订阅：懒加载 ja bundle → changeLanguage → <html lang>
    await waitFor(() => expect(i18n.language).toBe("ja"))
    expect(document.documentElement.lang).toBe("ja")
    expect(i18n.t("语言")).toBe("言語") // ja.json 种子 key
    // persist（zustand persist → localStorage oa-app-settings）
    const persisted = JSON.parse(localStorage.getItem("oa-app-settings") ?? "{}") as { state?: { locale?: string } }
    expect(persisted.state?.locale).toBe("ja")
  })

  it("切回简体中文 → 缺翻回退链兜底=key 本身", async () => {
    renderSwitcher()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "切换语言" }))
    await user.click(await screen.findByText("简体中文"))
    await waitFor(() => expect(i18n.language).toBe("zh-CN"))
    expect(i18n.t("语言")).toBe("语言") // 空 bundle → key 即中文
    expect(i18n.t("任意未登记文案")).toBe("任意未登记文案") // 绝不空白
  })
})
