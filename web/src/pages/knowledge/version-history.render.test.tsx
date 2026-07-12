// @vitest-environment jsdom
/** 版本历史 冒烟：抽屉版本列表 + 查看/对比切换 + 回滚确认。offline 演示数据（doc 302 有 v1/v2）。 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useAuthStore } from "@/stores/auth-store"
import { VersionHistory } from "./version-history"

beforeAll(() => {
  useAuthStore.setState({ offline: true, permissions: null, userId: null, token: null })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("版本历史", () => {
  // 只读用例先跑（回滚用例会改动共享 mock 状态）
  it("VIEWER（canEdit=false）→ 无回滚入口", async () => {
    render(<VersionHistory docId={302} currentVersion={3} currentText={"x"} canEdit={false} onRolledBack={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /历史版本/ }))
    await screen.findByText("v1")
    expect(screen.queryByRole("button", { name: /回滚到此版本/ })).toBeNull()
  })

  it("打开抽屉 → 版本列表 + 查看/对比 + 回滚确认调用", async () => {
    const onRolledBack = vi.fn()
    render(<VersionHistory docId={305} currentVersion={3} currentText={"当前正文内容"} canEdit onRolledBack={onRolledBack} />)
    // 打开
    fireEvent.click(screen.getByRole("button", { name: /历史版本/ }))
    // 版本列表（doc 305 有 v1）
    expect(await screen.findByText("v1")).toBeTruthy()
    // 对比/查看切换
    expect(screen.getByRole("button", { name: /对比当前/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /查看/ }))
    // 回滚：v1 !== 当前3 → 有回滚入口
    fireEvent.click(screen.getByRole("button", { name: /回滚到此版本/ }))
    expect(await screen.findByText(/回滚到 v1/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "确认回滚" }))
    await waitFor(() => expect(onRolledBack).toHaveBeenCalled())
  })
})
