// @vitest-environment jsdom
/**
 * 公式编辑器放大到弹窗 冒烟：放大按钮开 Dialog；弹窗里是**完整**公式编辑器（同 createFormulaExtensions，
 * 函数库/字段补全不降级）+ 同 value/onChange；防递归（弹窗内无放大按钮）。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useAppStore } from "@/stores/app-store"
import { AdvancedFormulaEditor } from "./advanced-formula-editor"
import type { FnDoc, FieldRef } from "@/lib/formula-highlight"

beforeAll(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const FUNCTIONS: FnDoc[] = [
  { name: "IF", insertTemplate: "IF()", signature: "IF(cond, a, b)", category: "逻辑", description: "条件判断", example: "IF(x>1,1,0)" },
]
const FIELDS: FieldRef[] = [{ key: "days", label: "天数" }]
const validate = () => ({ ok: true as const })

describe("公式编辑器放大到弹窗", () => {
  it("放大按钮开 Dialog，弹窗内是完整公式编辑器（函数库/补全保留），防递归", async () => {
    useAppStore.setState({ themeMode: "light" })
    const user = userEvent.setup()
    render(<AdvancedFormulaEditor value="IF(days>3)" onChange={() => {}} functions={FUNCTIONS} fields={FIELDS} validate={validate} />)

    // 内嵌：一个函数库 + 一个编辑器 + 一个放大按钮
    expect(screen.getAllByPlaceholderText("搜索函数")).toHaveLength(1)
    expect(document.querySelectorAll('[aria-label="放大编辑"]')).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "放大编辑" }))

    // Dialog：完整公式编辑器（含函数库搜索 + CM 编辑器）——非降级 CodeEditor
    expect(await screen.findByText(/编辑公式/)).toBeTruthy()
    await waitFor(() => expect(screen.getAllByPlaceholderText("搜索函数").length).toBe(2))
    await waitFor(() => expect(document.querySelectorAll(".cm-editor").length).toBe(2))
    // 防递归：弹窗内的公式编辑器不再 expandable → 全局仍只 1 个放大按钮
    expect(document.querySelectorAll('[aria-label="放大编辑"]')).toHaveLength(1)
  })
})
