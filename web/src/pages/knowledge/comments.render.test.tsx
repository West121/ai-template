// @vitest-environment jsdom
/** 评论 冒烟：抽屉评论树 + 发评论 + 删除 + @ 提及（OrgPicker）。offline 演示（doc 302 有 3 条种子评论）。 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useAuthStore } from "@/stores/auth-store"
import { DocComments } from "./comments"

beforeAll(() => {
  useAuthStore.setState({ offline: true, permissions: null, userId: null, token: null })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const openComments = async (canEdit = true) => {
  render(<DocComments docId={302} canEdit={canEdit} />)
  fireEvent.click(await screen.findByRole("button", { name: /评论/ }))
}

describe("文档评论", () => {
  it("打开抽屉 → 评论树（含回复）渲染", async () => {
    await openComments()
    expect(await screen.findByText("分支模型这段建议再举个例子。")).toBeTruthy()
    // 回复挂在根评论下
    expect(screen.getByText(/我补一个 feature 分支的示例/)).toBeTruthy()
    expect(screen.getByText("整体不错，已同意发布。")).toBeTruthy()
  })

  it("发评论 → 新评论出现", async () => {
    await openComments()
    await screen.findByText("整体不错，已同意发布。")
    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "疾风联调新评论QWE" } })
    fireEvent.click(screen.getByRole("button", { name: /发送/ }))
    expect(await screen.findByText("疾风联调新评论QWE")).toBeTruthy()
  })

  it("删除自己的评论（offline 放开）→ 该评论消失", async () => {
    await openComments()
    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "待删除评论ZXC" } })
    fireEvent.click(screen.getByRole("button", { name: /发送/ }))
    await screen.findByText("待删除评论ZXC")
    // 新评论为最新根评论 → 其删除按钮是 DOM 中最后一个
    const delButtons = screen.getAllByLabelText("删除评论")
    fireEvent.click(delButtons[delButtons.length - 1])
    await waitFor(() => expect(screen.queryByText("待删除评论ZXC")).toBeNull())
  })

  it("@ 提及 → 打开 OrgPicker", async () => {
    await openComments()
    fireEvent.click(screen.getByRole("button", { name: /提及/ }))
    expect(await screen.findByText("@ 提及成员")).toBeTruthy()
  })

  it("VIEWER（canEdit=false）→ 只读，无发送框/删除", async () => {
    await openComments(false)
    await screen.findByText("整体不错，已同意发布。")
    expect(screen.queryByLabelText("评论内容")).toBeNull()
    expect(screen.queryByRole("button", { name: /删除评论/ })).toBeNull()
  })
})
