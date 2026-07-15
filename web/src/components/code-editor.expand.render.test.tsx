// @vitest-environment jsdom
/**
 * CodeEditor 放大到弹窗 冒烟：放大按钮开 Dialog；内嵌 + 弹窗同一受控 value/onChange 实时同步；防递归（弹窗内无放大按钮）。
 */
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CodeEditor } from "./code-editor"

beforeAll(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

/** 受控宿主：外部按钮改 value → 验证内嵌 + 弹窗都同步（二者共享 value/onChange） */
function Harness() {
  const [v, setV] = useState("SYNCVALUE001")
  return (
    <div>
      <button onClick={() => setV("CHANGED222")}>ext</button>
      <CodeEditor value={v} onChange={setV} language="text" expandable minHeight="6rem" ariaLabel="代码" />
    </div>
  )
}

const bodyOcc = (needle: string) => (document.body.textContent?.match(new RegExp(needle, "g")) ?? []).length

describe("CodeEditor 放大到弹窗", () => {
  it("放大按钮开 Dialog + 内嵌/弹窗同步 + 防递归", async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness />)

    // 内嵌：一个编辑器 + 一个放大按钮，值出现一次
    expect(container.querySelectorAll(".cm-editor")).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "放大编辑" })).toHaveLength(1)
    await waitFor(() => expect(bodyOcc("SYNCVALUE001")).toBe(1))

    // 点放大 → Dialog 打开：标题 + 第二个编辑器；值出现两次（内嵌 + 弹窗，受控同 value）
    await user.click(screen.getByRole("button", { name: "放大编辑" }))
    expect(await screen.findByText(/编辑代码/)).toBeTruthy()
    await waitFor(() => expect(document.querySelectorAll(".cm-editor").length).toBe(2))
    await waitFor(() => expect(bodyOcc("SYNCVALUE001")).toBe(2))
    // 防递归：弹窗内编辑器不再 expandable → 全局仍只有 1 个放大按钮（用 querySelectorAll，含被 Radix aria-hidden 的背景）
    expect(document.querySelectorAll('[aria-label="放大编辑"]')).toHaveLength(1)

    // 外部改 value → 内嵌 + 弹窗都变（共享受控 value/onChange，实时同步）。
    // ext 按钮在弹窗背景（Radix aria-hidden + pointer-events:none）→ getByText 取、fireEvent 触发
    fireEvent.click(screen.getByText("ext"))
    await waitFor(() => expect(bodyOcc("CHANGED222")).toBe(2))
    expect(bodyOcc("SYNCVALUE001")).toBe(0)
  })
})
