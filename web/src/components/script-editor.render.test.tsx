// @vitest-environment jsdom
/**
 * 脚本编辑器精简布局 冒烟：
 *  - 安全警告一行常显（治理红线不可删）+ 语言 Tab + CodeEditor 主视觉
 *  - 「测试运行 / 调试」默认收起（上下文/样例变量/测试运行折进去）；展开后功能齐全
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import { useAppStore } from "@/stores/app-store"
import { ScriptEditor } from "./script-editor"

beforeAll(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const renderEditor = () => {
  useAuthStore.setState({ permissions: null, offline: false, token: "t" }) // permissions=null → wf:script:write 视为放行
  useAppStore.setState({ themeMode: "light" })
  return render(
    <TooltipProvider>
      <ScriptEditor value={{ lang: "groovy", code: "return true" }} onChange={() => {}} />
    </TooltipProvider>,
  )
}

describe("ScriptEditor 精简布局", () => {
  it("安全警告一行常显 + CodeEditor 主视觉 + 调试区默认收起", () => {
    const { container } = renderEditor()
    // 治理红线：非沙箱 + 完整权限一行必可见
    expect(screen.getByText(/脚本以应用完整权限运行 · 非沙箱/)).toBeTruthy()
    // 主视觉：语言 Tab + 代码编辑器
    expect(screen.getByRole("tab", { name: "Groovy" })).toBeTruthy()
    expect(container.querySelector(".cm-editor")).toBeTruthy()
    // 调试区折叠：触发器在、但「测试运行」按钮/上下文默认不渲染
    expect(screen.getByRole("button", { name: /测试运行 \/ 调试/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "测试运行" })).toBeNull()
    expect(screen.queryByText("可用上下文（后端注入）")).toBeNull()
  })

  it("展开「测试运行 / 调试」→ 上下文 + 样例变量 + 测试运行按钮齐全", async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole("button", { name: /测试运行 \/ 调试/ }))
    expect(await screen.findByText("可用上下文（后端注入）")).toBeTruthy()
    expect(screen.getByRole("button", { name: "测试运行" })).toBeTruthy()
    expect(screen.getByText(/样例流程变量/)).toBeTruthy()
  })
})
