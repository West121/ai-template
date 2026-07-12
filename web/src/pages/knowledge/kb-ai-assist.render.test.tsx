// @vitest-environment jsdom
/**
 * AI 写作辅助 冒烟：选区气泡菜单出现 → 动作调用 → 流式预览 → 接受（替换/插入）/取消。
 * 用 fake TipTap editor（只实现 KbAiAssist 用到的 API）驱动，避免真实 PM 依赖。offline → mock 流式。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { Editor } from "@tiptap/react"
import { useAuthStore } from "@/stores/auth-store"
import { KbAiAssist } from "./kb-ai-assist"

beforeAll(() => {
  useAuthStore.setState({ offline: true, permissions: null, userId: null, token: null })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

interface Spies {
  insertContentAt: ReturnType<typeof vi.fn>
  insertContent: ReturnType<typeof vi.fn>
  focusArg: unknown[]
}
function fakeEditor(from: number, to: number, text = "选中的示例文本"): { editor: Editor; spies: Spies } {
  const insertContentAt = vi.fn()
  const insertContent = vi.fn()
  const focusArg: unknown[] = []
  const chain: Record<string, unknown> = {}
  chain.focus = (...a: unknown[]) => {
    focusArg.push(...a)
    return chain
  }
  chain.insertContentAt = (...a: unknown[]) => {
    insertContentAt(...a)
    return chain
  }
  chain.insertContent = (...a: unknown[]) => {
    insertContent(...a)
    return chain
  }
  chain.run = () => true
  const editor = {
    state: { selection: { from, to }, doc: { content: { size: 100 }, textBetween: () => text } },
    view: { coordsAtPos: () => ({ top: 120, left: 40 }) },
    getText: () => "全文上下文示例",
    chain: () => chain,
    on: () => {},
    off: () => {},
  } as unknown as Editor
  return { editor, spies: { insertContentAt, insertContent, focusArg } }
}

describe("KbAiAssist", () => {
  it("有选区 → 气泡菜单出现（润色/纠错/翻译/总结）", () => {
    const { editor } = fakeEditor(1, 6)
    render(<KbAiAssist editor={editor} docId={302} />)
    const bubble = screen.getByRole("menu", { name: "AI 写作辅助" })
    expect(bubble).toBeTruthy()
    for (const label of ["润色", "纠错", "翻译", "总结"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    // AI 下拉入口
    expect(screen.getByRole("button", { name: "AI" })).toBeTruthy()
  })

  it("润色（替换类）→ 流式预览 → 接受 → insertContentAt(选区范围, html)", async () => {
    const { editor, spies } = fakeEditor(2, 8)
    render(<KbAiAssist editor={editor} docId={302} />)
    // 气泡里点「润色」
    fireEvent.click(screen.getByRole("menu", { name: "AI 写作辅助" }).querySelector("button")!)
    // 预览对话框 + 原文对照
    expect(await screen.findByText(/AI 写作辅助 · 润色/)).toBeTruthy()
    expect(screen.getByText("原文")).toBeTruthy()
    // 流式生成完成 → 「接受」可点
    const accept = await screen.findByRole("button", { name: /接受/ }, { timeout: 3000 })
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(accept)
    // 替换选区：insertContentAt({from:2,to:8}, html)
    expect(spies.insertContentAt).toHaveBeenCalledTimes(1)
    expect(spies.insertContentAt.mock.calls[0][0]).toEqual({ from: 2, to: 8 })
    expect(String(spies.insertContentAt.mock.calls[0][1])).toContain("<p>")
  })

  it("总结（插入类）→ 接受 → 文末 insertContent（非替换）", async () => {
    const { editor, spies } = fakeEditor(2, 8)
    render(<KbAiAssist editor={editor} docId={302} />)
    // 气泡里点「总结」
    const bubbleBtns = screen.getByRole("menu", { name: "AI 写作辅助" }).querySelectorAll("button")
    fireEvent.click([...bubbleBtns].find((b) => b.textContent === "总结")!)
    const accept = await screen.findByRole("button", { name: /接受/ }, { timeout: 3000 })
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(accept)
    expect(spies.insertContent).toHaveBeenCalledTimes(1)
    expect(spies.focusArg).toContain("end") // focus('end') → 文末插入
    expect(spies.insertContentAt).not.toHaveBeenCalled()
  })

  it("生成中「取消」→ 停止（切回 接受/丢弃/重试 态）", async () => {
    const { editor } = fakeEditor(2, 8)
    render(<KbAiAssist editor={editor} docId={302} />)
    fireEvent.click(screen.getByRole("menu", { name: "AI 写作辅助" }).querySelector("button")!)
    const cancel = await screen.findByRole("button", { name: /取消/ })
    fireEvent.click(cancel)
    await waitFor(() => expect(screen.queryByRole("button", { name: /取消/ })).toBeNull())
    expect(screen.getByRole("button", { name: /丢弃/ })).toBeTruthy()
  })

  it("无选区 → 不出气泡菜单（续写等仍可从 AI 下拉用）", () => {
    const { editor } = fakeEditor(3, 3)
    render(<KbAiAssist editor={editor} docId={302} />)
    expect(screen.queryByRole("menu", { name: "AI 写作辅助" })).toBeNull()
    expect(screen.getByRole("button", { name: "AI" })).toBeTruthy()
  })
})
