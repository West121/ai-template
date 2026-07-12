// @vitest-environment jsdom
/**
 * 用户管理左树右表渲染冒烟（反白屏第 4 条）：
 *  - 左 <DeptTree> + 右 <DataTable> 同页挂载，在线 + stub fetch → 用户名与部门名同时渲染，不抛错。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import UserPage from "./user"

const DEPTS = [
  {
    id: 10,
    name: "研发中心",
    enabled: true,
    userCount: 8,
    sort: 10,
    children: [{ id: 11, name: "前端组", enabled: true, userCount: 3, sort: 10 }],
  },
  { id: 20, name: "市场部", enabled: true, userCount: 5, sort: 20 },
]
const USERS = [
  {
    id: 1,
    name: "张三",
    username: "zhangsan",
    empNo: "XC0001",
    phone: "13800000001",
    enabled: true,
    primaryDeptName: "研发中心",
    primaryPostName: "工程师",
    roleNames: ["管理员"],
  },
  {
    id: 2,
    name: "李四",
    username: "lisi",
    empNo: "XC0002",
    phone: "13800000002",
    enabled: false,
    primaryDeptName: "市场部",
    primaryPostName: "专员",
    roleNames: ["普通用户"],
  },
]

beforeAll(() => {
  useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  vi.stubGlobal("fetch", async (url: string) => {
    const p = String(url)
    let data: unknown = []
    if (p.includes("/api/system/depts/tree")) data = DEPTS
    else if (p.includes("/api/system/users")) data = { list: USERS, total: USERS.length, pageNum: 1, pageSize: 100 }
    else if (p.includes("/api/system/posts")) data = { list: [], total: 0, pageNum: 1, pageSize: 100 }
    else if (p.includes("/api/system/roles")) data = { list: [], total: 0, pageNum: 1, pageSize: 100 }
    return { status: 200, json: async () => ({ code: 0, data }) } as unknown as Response
  })
})
afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("用户管理左树右表渲染冒烟", () => {
  it("左树部门名 + 右表用户名同时渲染，不抛错", async () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <UserPage />
        </TooltipProvider>
      </MemoryRouter>,
    )
    // 右表用户名（列表加载完成）
    expect(await screen.findByText("张三")).toBeTruthy()
    // 左树部门名（多处可能出现：树节点 + 表格部门列，用 findAll 兜底）
    await waitFor(() => expect(screen.getAllByText("研发中心").length).toBeGreaterThan(0))
    expect(screen.getByText("全部部门")).toBeTruthy()
  })

  it("新增用户表单：直属上级（多选）+ 默认部门负责人语义提示", async () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <UserPage />
        </TooltipProvider>
      </MemoryRouter>,
    )
    await screen.findByText("张三")
    fireEvent.click(screen.getByRole("button", { name: /新增用户/ }))
    // 直属上级字段 + 语义文案（多选 + 留空默认部门负责人）
    expect(await screen.findByText(/留空则默认取所在部门负责人/)).toBeTruthy()
    expect(screen.getByText("点击选择直属上级（可多选）")).toBeTruthy()
  })
})
