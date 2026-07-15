// @vitest-environment jsdom
/**
 * 统一 CodeEditor 冒烟：各语言挂载不炸 + value 非字符串容错 + 只读 + 换行/行号开关。
 * CodeMirror6 在 jsdom 下无布局但会同步建 DOM（.cm-editor / .cm-content），据此断言挂载成功。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, waitFor } from "@testing-library/react"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { diagnosticCount, forceLinting } from "@codemirror/lint"
import { CodeEditor, type CodeLanguage } from "./code-editor"
import { codeEditorExtensions } from "@/lib/code-editor-cm"

afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("CodeEditor", () => {
  const langs: CodeLanguage[] = ["json", "javascript", "typescript", "tsx", "java", "sql", "groovy", "python", "expression", "text"]

  it.each(langs)("language=%s 挂载不炸（真解析语言含 ts/java）", (language) => {
    const { container } = render(<CodeEditor value={`// ${language}\n{"a":1}`} language={language} onChange={() => {}} />)
    expect(container.querySelector(".cm-editor")).toBeTruthy()
  })

  it("默认启用 IDE 功能：折叠 gutter 随行号出现", () => {
    const { container } = render(<CodeEditor value={"function f() {\n  return 1\n}"} language="typescript" />)
    expect(container.querySelector(".cm-foldGutter")).toBeTruthy()
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

  describe("lint 参数", () => {
    const count = (o: Parameters<typeof codeEditorExtensions>[0]) => codeEditorExtensions(o).length
    it("json 默认开 lint（比 lint=false 多挂一个 linter 扩展）", () => {
      expect(count({ language: "json", dark: false })).toBe(count({ language: "json", dark: false, lint: false }) + 1)
    })
    it("json lint=true 与默认一致（都含 linter）", () => {
      expect(count({ language: "json", dark: false, lint: true })).toBe(count({ language: "json", dark: false }))
    })
    it("非 json 语言：lint 参数不加 linter（无差异）", () => {
      expect(count({ language: "text", dark: false, lint: true })).toBe(count({ language: "text", dark: false, lint: false }))
      expect(count({ language: "sql", dark: false, lint: true })).toBe(count({ language: "sql", dark: false, lint: false }))
    })
    // 行为级：无头 EditorView + forceLinting 触发 lint，读诊断数（CM 的 lint 下划线装饰需布局，jsdom 不渲染，故不查 DOM）
    const diagnosticsFor = async (doc: string, lint?: boolean): Promise<number> => {
      const view = new EditorView({ state: EditorState.create({ doc, extensions: codeEditorExtensions({ language: "json", dark: false, lint }) }) })
      try {
        forceLinting(view)
        await waitFor(() => expect(typeof diagnosticCount(view.state)).toBe("number"))
        return diagnosticCount(view.state)
      } finally {
        view.destroy()
      }
    }
    it("json + lint=true：非法 JSON 产生诊断（会标红）", async () => {
      await waitFor(async () => expect(await diagnosticsFor('{"a": }')).toBeGreaterThan(0), { timeout: 2000 })
    })
    it("json + lint=false：模板 JSON（含 {{}}）零诊断（不标红）", async () => {
      expect(await diagnosticsFor('{ "id": "{{payload.id}}" }', false)).toBe(0)
    })
    it("json + lint=false：即使非法 JSON 也零诊断", async () => {
      expect(await diagnosticsFor('{"a": }', false)).toBe(0)
    })
  })
})
