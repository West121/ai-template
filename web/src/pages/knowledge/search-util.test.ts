import { describe, it, expect } from "vitest"
import { buildSnippet } from "./search-util"

describe("buildSnippet", () => {
  it("命中处用 <mark> 包裹关键词，前后取窗口", () => {
    const s = buildSnippet("为保证协作质量，所有提交遵循以下约定", "提交")
    expect(s).toContain("<mark>提交</mark>")
    expect(s).toContain("所有")
  })

  it("HTML 转义（防注入）：尖括号被实体化，仅 mark 是我们加的标签", () => {
    const s = buildSnippet("使用 <script>alert(1)</script> 是危险的写法", "危险")
    expect(s).toContain("&lt;script&gt;")
    expect(s).not.toContain("<script>")
    expect(s).toContain("<mark>危险</mark>")
  })

  it("无命中 → 取开头一段（不含 mark）", () => {
    const s = buildSnippet("接口设计规范统一响应封套", "不存在")
    expect(s).not.toContain("<mark>")
    expect(s.startsWith("接口设计规范")).toBe(true)
  })

  it("空文本 / 空词 → 安全兜底不抛", () => {
    expect(buildSnippet("", "x")).toBe("")
    expect(buildSnippet("正文", "")).toContain("正文")
  })
})
