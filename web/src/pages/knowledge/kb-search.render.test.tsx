// @vitest-environment jsdom
/**
 * 知识库搜索弹窗 冒烟：输入关键词 → 演示结果（高亮 snippet + matchedBy 徽标）→ 点击跳转；空数组容错。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import { KbSearchDialog } from "./kb-search"

const navigate = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>()
  return { ...actual, useNavigate: () => navigate }
})

beforeAll(() => {
  useAuthStore.setState({ offline: true, permissions: null, userId: null, token: null })
})
afterEach(() => {
  cleanup()
  navigate.mockClear()
})
vi.spyOn(console, "error").mockImplementation(() => {})

const renderDlg = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <KbSearchDialog open onOpenChange={() => {}} />
      </TooltipProvider>
    </MemoryRouter>,
  )

describe("知识库搜索弹窗", () => {
  it("输入关键词 → 命中文档结果（高亮 + matchedBy）→ 点击跳 /knowledge/{space}?doc=", async () => {
    renderDlg()
    fireEvent.change(screen.getByLabelText("搜索关键词"), { target: { value: "提交" } })
    // 命中「代码提交规约」
    const hit = await screen.findByText("代码提交规约")
    // <mark> 高亮片段渲染
    await waitFor(() => expect(document.querySelector("mark")).toBeTruthy())
    fireEvent.click(hit)
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/knowledge\/101\?doc=302$/))
  })

  it("无命中 → 空态提示，不白屏", async () => {
    renderDlg()
    fireEvent.change(screen.getByLabelText("搜索关键词"), { target: { value: "绝不存在的词zzz" } })
    expect(await screen.findByText(/未找到匹配/)).toBeTruthy()
  })
})
