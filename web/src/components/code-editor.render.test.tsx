// @vitest-environment jsdom
/**
 * 统一 CodeEditor 冒烟：各语言挂载不炸 + value 非字符串容错 + 只读 + 换行/行号开关。
 * CodeMirror6 在 jsdom 下无布局但会同步建 DOM（.cm-editor / .cm-content），据此断言挂载成功。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { CodeEditor, type CodeLanguage } from "./code-editor"

afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("CodeEditor", () => {
  const langs: CodeLanguage[] = ["json", "javascript", "sql", "groovy", "python", "expression", "text"]

  it.each(langs)("language=%s 挂载不炸", (language) => {
    const { container } = render(<CodeEditor value={`// ${language}\n{"a":1}`} language={language} onChange={() => {}} />)
    expect(container.querySelector(".cm-editor")).toBeTruthy()
  })

  it("value 非字符串（null/对象）→ 容错为字符串，不白屏", () => {
    const { container: c1 } = render(<CodeEditor value={null as unknown as string} language="json" />)
    expect(c1.querySelector(".cm-editor")).toBeTruthy()
    const { container: c2 } = render(<CodeEditor value={{ a: 1 } as unknown as string} language="json" />)
    expect(c2.querySelector(".cm-editor")).toBeTruthy()
  })

  it("readOnly / lineWrap / 无行号 均可挂载", () => {
    const { container } = render(<CodeEditor value="SELECT 1" language="sql" readOnly lineWrap lineNumbers={false} ariaLabel="只读示例" />)
    expect(container.querySelector(".cm-editor")).toBeTruthy()
    // 关闭行号 → 无行号 gutter
    expect(container.querySelector(".cm-lineNumbers")).toBeNull()
  })

  it("默认显示行号 gutter", () => {
    const { container } = render(<CodeEditor value={"a\nb"} language="javascript" />)
    expect(container.querySelector(".cm-lineNumbers")).toBeTruthy()
  })
})
