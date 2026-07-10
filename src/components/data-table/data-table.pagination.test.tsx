// @vitest-environment jsdom
/**
 * DataTable 分页交互回归（用户报“所有表格分页用不了”的复现测试）。
 * 本地模式：25 行 / 每页 10 → 3 页；点“下一页”应显示第 11-20 行。
 * 服务端模式：点“下一页”应回调 onPaginationChange(1, 10)。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render as rtlRender, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ColumnDef } from "@tanstack/react-table"
import type { ReactElement } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DataTable } from "./data-table"

const render = (ui: ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>)

// vitest 未开 globals，RTL 的自动 cleanup 不生效——显式清理，避免跨用例 DOM 残留
afterEach(cleanup)

// Radix Select 在 jsdom 需要的 DOM API polyfill（否则下拉打不开）
window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView ?? (() => {})
window.HTMLElement.prototype.hasPointerCapture = window.HTMLElement.prototype.hasPointerCapture ?? (() => false)
window.HTMLElement.prototype.releasePointerCapture = window.HTMLElement.prototype.releasePointerCapture ?? (() => {})

interface Row {
  id: number
  name: string
}

const columns: ColumnDef<Row, unknown>[] = [
  {
    accessorKey: "name",
    meta: { title: "名称" },
    header: () => <span>名称</span>,
    cell: ({ row }) => <span>{row.original.name}</span>,
  },
]

const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i, name: `row-${i}` }))

/** 页脚分页按钮：固定顺序 [首页, 上一页, 下一页, 末页]（icon 按钮无文本，按容器定位） */
function pagerButtons() {
  const pageLabel = screen.getAllByText(/\/ \d+ 页/, { selector: "span" })[0]
  const group = pageLabel.parentElement as HTMLElement
  return within(group).getAllByRole("button")
}


describe("DataTable 分页", () => {
  it("本地模式：25 行默认每页 10 → 3 页；下一页显示 11-20 行", async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={rows(25)} />)

    expect(screen.getByText("row-0")).toBeTruthy()
    expect(screen.queryByText("row-10")).toBeNull()
    expect(screen.getByText(/1 \/ 3 页/)).toBeTruthy()

    const [, , next] = pagerButtons()
    expect((next as HTMLButtonElement).disabled).toBe(false)
    await user.click(next)

    expect(screen.getByText(/2 \/ 3 页/)).toBeTruthy()
    expect(screen.getByText("row-10")).toBeTruthy()
    expect(screen.queryByText("row-0")).toBeNull()
  })

  it("本地模式：改每页条数生效", async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={rows(25)} />)
    // 打开每页条数下拉选 20
    const trigger = screen.getAllByRole("combobox")[0]
    await user.click(trigger)
    await user.click(await screen.findByRole("option", { name: "20" }))
    expect(screen.getByText(/1 \/ 2 页/)).toBeTruthy()
    expect(screen.getByText("row-19")).toBeTruthy()
  })

  it("服务端模式：下一页回调 onPaginationChange(1, 10)", async () => {
    const user = userEvent.setup()
    const onPaginationChange = vi.fn()
    render(
      <DataTable
        columns={columns}
        data={rows(10)}
        serverPagination={{ pageIndex: 0, pageSize: 10, rowCount: 35, onPaginationChange }}
      />,
    )
    expect(screen.getByText(/1 \/ 4 页/)).toBeTruthy()
    const [, , next] = pagerButtons()
    await user.click(next)
    expect(onPaginationChange).toHaveBeenCalledWith(1, 10)
  })
})
