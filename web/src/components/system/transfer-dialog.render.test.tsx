// @vitest-environment jsdom
/**
 * 转岗弹层 冒烟（DP3）：
 *  - offline → 渲染部门/岗位/角色/保留天数（renders without throwing）+ 空角色兜底
 *  - online → 选部门+岗位+角色、填保留天数 → 提交 POST 形状 {deptId,postId,roleIds,retentionDays}
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useAuthStore } from "@/stores/auth-store"
import { TransferDialog } from "./transfer-dialog"

const deptOptions = [
  { id: 5, name: "研发部", depth: 0 },
  { id: 7, name: "市场部", depth: 0 },
]
const postOptions = [
  { id: 11, name: "工程师" },
  { id: 12, name: "经理" },
]
const roleOptions = [
  { id: 21, name: "普通员工" },
  { id: 22, name: "管理员" },
]

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
  vi.unstubAllGlobals()
})
vi.spyOn(console, "error").mockImplementation(() => {})

describe("TransferDialog（DP3）", () => {
  it("offline → 渲染部门/岗位/角色/保留天数，空角色兜底，不白屏", () => {
    useAuthStore.setState({ offline: true, token: null, permissions: null, userId: 1 })
    render(
      <TransferDialog
        open
        onOpenChange={() => {}}
        user={{ id: 9, name: "张三", currentDeptName: "研发部" }}
        deptOptions={deptOptions}
        postOptions={postOptions}
        roleOptions={[]}
        onDone={() => {}}
      />,
    )
    expect(screen.getByText("转岗 · 张三")).toBeTruthy()
    expect(screen.getByText("新部门")).toBeTruthy()
    expect(screen.getByText("新岗位")).toBeTruthy()
    expect(screen.getByText("新角色")).toBeTruthy()
    expect(screen.getByPlaceholderText("留空=系统默认，0=不保留")).toBeTruthy()
    expect(screen.getByText("暂无角色")).toBeTruthy() // 角色空 → 兜底不炸
  })

  it("online → 选部门+岗位+角色+保留天数，提交 POST 形状 {deptId,postId,roleIds,retentionDays}", async () => {
    useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
    const user = userEvent.setup()
    const calls: { url: string; method: string; body: string }[] = []
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") })
      return { status: 200, json: async () => ({ code: 0, data: { assignmentId: 1, oldDeptId: 5, newDeptId: 7, retentionUntil: "2026-08-11" } }) } as unknown as Response
    })
    const onDone = vi.fn()
    render(
      <TransferDialog
        open
        onOpenChange={() => {}}
        user={{ id: 9, name: "张三" }}
        deptOptions={deptOptions}
        postOptions={postOptions}
        roleOptions={roleOptions}
        onDone={onDone}
      />,
    )

    // 选新部门 = 市场部(7)
    await user.click(screen.getAllByRole("combobox")[0])
    await user.click(await screen.findByRole("option", { name: "市场部" }))
    // 选新岗位 = 经理(12)
    await user.click(screen.getAllByRole("combobox")[1])
    await user.click(await screen.findByRole("option", { name: "经理" }))
    // 勾一个角色 = 管理员(22)
    await user.click(screen.getByRole("checkbox", { name: "管理员" }))
    // 保留天数 = 0（不保留）
    await user.type(screen.getByPlaceholderText("留空=系统默认，0=不保留"), "0")

    await user.click(screen.getByRole("button", { name: /确认转岗/ }))

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/users/9/transfer"))).toBe(true))
    const post = calls.find((c) => c.method === "POST" && c.url.includes("/transfer"))!
    expect(post.body).toContain('"deptId":7')
    expect(post.body).toContain('"postId":12')
    expect(post.body).toContain('"roleIds":[22]')
    expect(post.body).toContain('"retentionDays":0')
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
