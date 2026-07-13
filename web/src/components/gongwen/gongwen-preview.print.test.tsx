// @vitest-environment jsdom
/** 红头正文打印:走隔离 iframe(srcdoc 含纸张 HTML + 复制的样式表),不再 window.print() 整页(空白根因)。 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { printGongwenPaper } from "./gongwen-preview"

afterEach(() => {
  document.querySelectorAll("iframe").forEach((f) => f.remove())
  vi.restoreAllMocks()
})

describe("printGongwenPaper", () => {
  it("把红头正文塞进隔离 iframe(srcdoc 含 .gongwen-paper 与正文),不直接 window.print", () => {
    const printSpy = vi.fn()
    vi.stubGlobal("print", printSpy) // window.print 不应被直接调用(应走 iframe)
    printGongwenPaper('<div class="gw-typearea">红头正文内容XYZ</div>')
    const iframe = document.querySelector("iframe")
    expect(iframe).toBeTruthy()
    const src = iframe?.getAttribute("srcdoc") ?? (iframe as HTMLIFrameElement)?.srcdoc ?? ""
    expect(src).toContain("gongwen-paper")
    expect(src).toContain("gw-page")
    expect(src).toContain("红头正文内容XYZ")
    expect(src).toContain("@page") // 打印页面样式已注入
    expect(printSpy).not.toHaveBeenCalled() // 走 iframe 打印,不整页 window.print
  })

  it("空正文不创建 iframe(防空打印)", () => {
    printGongwenPaper("")
    expect(document.querySelector("iframe")).toBeNull()
  })
})
