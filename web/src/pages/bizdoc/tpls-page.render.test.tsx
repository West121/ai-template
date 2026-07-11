// @vitest-environment jsdom
/**
 * 单据模板页整页渲染冒烟(用户报白屏后的回归):挂真实路由组件,渲染不抛错即页面可开。
 * jsdom 无后端 → api 抛 NetworkError → withMock 走演示数据,与离线打开页面同路径。
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import BizdocTplsPage from "./tpls-page"

afterEach(cleanup)

describe("单据模板页渲染冒烟", () => {
  it("整页挂载不抛错,渲染出页面骨架", async () => {
    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={["/bizdoc/tpls"]}>
          <BizdocTplsPage />
        </MemoryRouter>
      </TooltipProvider>,
    )
    // 页面标题/新建入口出现 = 路由组件成功渲染(白屏=这里直接抛错)
    const hits = await screen.findAllByText(/单据模板|新建模板/)
    expect(hits.length).toBeGreaterThan(0)
  })
})
