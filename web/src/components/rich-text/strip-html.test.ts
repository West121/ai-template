/**
 * stripHtml / isEmptyHtml / normalizeRichText 纯函数单测（契约 §6：空文档归一 + 摘要）。
 */
import { describe, expect, it } from "vitest"
import { isEmptyHtml, normalizeRichText, stripHtml } from "./strip-html"

describe("stripHtml", () => {
  it("剥标签并保留文本", () => {
    expect(stripHtml("<p>你好<strong>世界</strong></p>")).toBe("你好世界")
  })

  it("块级闭合 / <br> 折为空格（段落间不粘连）", () => {
    expect(stripHtml("<p>第一段</p><p>第二段</p>")).toBe("第一段 第二段")
    expect(stripHtml("<p>a<br>b<br/>c</p>")).toBe("a b c")
    expect(stripHtml("<ul><li>甲</li><li>乙</li></ul>")).toBe("甲 乙")
  })

  it("解常用实体且不二次解码", () => {
    expect(stripHtml("A&nbsp;B")).toBe("A B")
    expect(stripHtml("&lt;script&gt;")).toBe("<script>")
    // &amp;lt; 应解为字面 "&lt;"，而非再解成 "<"
    expect(stripHtml("&amp;lt;")).toBe("&lt;")
  })

  it("超长截断加省略号", () => {
    expect(stripHtml("<p>0123456789</p>", 5)).toBe("01234…")
    expect(stripHtml("<p>短</p>", 50)).toBe("短")
  })

  it("纯文本输入幂等；空值回空串", () => {
    expect(stripHtml("同意。")).toBe("同意。")
    expect(stripHtml("")).toBe("")
    expect(stripHtml(null)).toBe("")
    expect(stripHtml(undefined)).toBe("")
  })
})

describe("isEmptyHtml（空文档归一，防骗过「意见必填」）", () => {
  it("空段落 / 空白 / 空值 → 空", () => {
    expect(isEmptyHtml("")).toBe(true)
    expect(isEmptyHtml(null)).toBe(true)
    expect(isEmptyHtml(undefined)).toBe(true)
    expect(isEmptyHtml("<p></p>")).toBe(true)
    expect(isEmptyHtml("<p><br></p>")).toBe(true)
    expect(isEmptyHtml("<p>   </p>")).toBe(true)
    expect(isEmptyHtml("  \n ")).toBe(true)
  })

  it("有文字 / 内容元素（图片、表格）→ 非空", () => {
    expect(isEmptyHtml("<p>同意</p>")).toBe(false)
    expect(isEmptyHtml('<img src="/x.png">')).toBe(false)
    expect(isEmptyHtml("<table><tr><td></td></tr></table>")).toBe(false)
  })
})

describe("normalizeRichText（提交前归一）", () => {
  it("空 HTML → \"\"；非空原样", () => {
    expect(normalizeRichText("<p></p>")).toBe("")
    expect(normalizeRichText("<p><br></p>")).toBe("")
    expect(normalizeRichText("<p>同意</p>")).toBe("<p>同意</p>")
  })
})
