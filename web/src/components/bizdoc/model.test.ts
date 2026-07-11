/**
 * BizDoc 模板 JSON / 渲染映射用例（契约 §4 + §8 裁定）。
 */
import { describe, expect, it } from "vitest"
import {
  emptyTemplate,
  fieldText,
  formatValue,
  interpolate,
  paperSize,
  parseTemplate,
  staleElementIds,
  textStyleOf,
  type BdRenderCtx,
  type BdTemplate,
} from "./model"

const CTX: BdRenderCtx = {
  data: {
    expenseType: "差旅费",
    amount: 2380.5,
    docNo: "BX〔2026〕0012",
    creator: "王经理",
    approved: true,
    tags: ["加急", "重要"],
    owner: { name: "李四" },
  },
  fields: { expenseType: "报销类型", amount: "报销金额（元）" },
}

describe("模板 JSON 契约", () => {
  it("parseTemplate：字符串/对象往返、非法回 null", () => {
    const tpl: BdTemplate = {
      schemaVersion: 1,
      paper: "A4",
      landscape: false,
      margin: [10, 10, 10, 10],
      elements: [
        { id: "e1", type: "label", x: 80, y: 12, w: 50, h: 8, text: "请假申请单", style: { fontSize: 16, bold: true, align: "center" } },
        { id: "e2", type: "field", x: 25, y: 30, w: 60, h: 7, field: "leaveType", label: "请假类型:" },
        { id: "e7", type: "sysfield", x: 150, y: 30, w: 50, h: 7, field: "docNo", label: "单号:" },
        { id: "e4", type: "line", x: 10, y: 55, w: 190, h: 0 },
      ],
    }
    // JSON 序列化往返无损（模板即纯 JSON，无变换层）
    expect(parseTemplate(JSON.stringify(tpl))).toEqual(tpl)
    expect(parseTemplate(tpl)).toEqual(tpl)
    expect(parseTemplate("not json")).toBeNull()
    expect(parseTemplate(null)).toBeNull()
    expect(emptyTemplate("A5").paper).toBe("A5")
  })

  it("paperSize：A4/A5 + 横向交换宽高", () => {
    expect(paperSize("A4", false)).toEqual({ w: 210, h: 297 })
    expect(paperSize("A4", true)).toEqual({ w: 297, h: 210 })
    expect(paperSize("A5", false)).toEqual({ w: 148, h: 210 })
  })
})

describe("渲染映射", () => {
  it("formatValue：空/数组/对象/布尔/数字", () => {
    expect(formatValue(null)).toBe("")
    expect(formatValue("")).toBe("")
    expect(formatValue(CTX.data.tags)).toBe("加急、重要")
    expect(formatValue(CTX.data.owner)).toBe("李四")
    expect(formatValue(true)).toBe("是")
    expect(formatValue(2380.5)).toBe("2380.5")
  })

  it("fieldText：前缀 + 值；失效字段 stale 标记且值为空", () => {
    const ok = fieldText({ id: "x", type: "field", x: 0, y: 0, w: 10, h: 5, field: "expenseType", label: "报销类型：" }, CTX)
    expect(ok).toEqual({ prefix: "报销类型：", value: "差旅费", stale: false })
    const sys = fieldText({ id: "y", type: "sysfield", x: 0, y: 0, w: 10, h: 5, field: "docNo", label: "单号：" }, CTX)
    expect(sys.value).toBe("BX〔2026〕0012")
    const stale = fieldText({ id: "z", type: "field", x: 0, y: 0, w: 10, h: 5, field: "notExist" }, CTX)
    expect(stale).toEqual({ prefix: "", value: "", stale: true })
  })

  it("interpolate：{{key}} 插值，缺键输出空串", () => {
    expect(interpolate("单号：{{docNo}}", CTX.data)).toBe("单号：BX〔2026〕0012")
    expect(interpolate("{{docNo}}-{{missing}}", CTX.data)).toBe("BX〔2026〕0012-")
  })

  it("staleElementIds：找出失效 field/table 绑定", () => {
    const tpl: BdTemplate = {
      schemaVersion: 1,
      paper: "A4",
      landscape: false,
      margin: [10, 10, 10, 10],
      elements: [
        { id: "ok", type: "field", x: 0, y: 0, w: 10, h: 5, field: "expenseType" },
        { id: "bad", type: "field", x: 0, y: 0, w: 10, h: 5, field: "ghost" },
        { id: "label", type: "label", x: 0, y: 0, w: 10, h: 5, text: "静态" },
      ],
    }
    expect(staleElementIds(tpl, CTX)).toEqual(["bad"])
  })

  it("textStyleOf：pt 字号 + 缺省（10.5pt 宋体左对齐）+ §8 字体族扩展", () => {
    expect(textStyleOf(undefined)).toMatchObject({ fontSize: "10.5pt", fontWeight: 400, textAlign: "left" })
    const s = textStyleOf({ fontSize: 16, bold: true, align: "center", fontFamily: "hei" })
    expect(s.fontSize).toBe("16pt")
    expect(s.fontWeight).toBe(700)
    expect(s.textAlign).toBe("center")
    expect(s.fontFamily).toContain("SimHei")
  })
})
