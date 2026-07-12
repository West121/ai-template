// @vitest-environment jsdom
/** 空间图标容错渲染：lucide 名→图标 svg、emoji→文本、空→兜底、未知 lucide 名→兜底文件夹。 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { SpaceIcon } from "./space-icon"

afterEach(cleanup)

describe("SpaceIcon", () => {
  it("lucide 名(BookOpen/Boxes) 渲染成 svg 图标而非字面文本", () => {
    const { container, queryByText } = render(<SpaceIcon icon="BookOpen" />)
    expect(container.querySelector("svg")).toBeTruthy()
    expect(queryByText("BookOpen")).toBeNull()
  })

  it("未知 lucide 名 兜底成文件夹 svg，不白屏", () => {
    const { container, queryByText } = render(<SpaceIcon icon="SomethingUnknownIcon" />)
    expect(container.querySelector("svg")).toBeTruthy()
    expect(queryByText("SomethingUnknownIcon")).toBeNull()
  })

  it("emoji 原样渲染为文本", () => {
    const { getByText, container } = render(<SpaceIcon icon="🚀" />)
    expect(getByText("🚀")).toBeTruthy()
    expect(container.querySelector("svg")).toBeNull()
  })

  it("空/undefined 兜底 📁", () => {
    expect(render(<SpaceIcon icon="" />).getByText("📁")).toBeTruthy()
    cleanup()
    expect(render(<SpaceIcon icon={null} />).getByText("📁")).toBeTruthy()
  })
})
