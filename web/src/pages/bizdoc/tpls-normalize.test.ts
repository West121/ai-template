/**
 * /tpls/{id}/fields 响应形状归一回归（用户白屏根因之二）：
 * 真实后端返回 {bindType,bindCode,fields,groups} 对象，mock 是裸数组——归一后都必须是 DefField[]。
 */
import { describe, expect, it } from "vitest"
import { normalizeTplFields } from "./tpls"

describe("normalizeTplFields", () => {
  it("真实后端对象形状（含空 groups）→ fields 数组", () => {
    const real = {
      bindType: "FORM",
      bindCode: "leave",
      fields: [
        { label: "请假类型", key: "leaveType" },
        { label: "请假天数", key: "days" },
      ],
      groups: [],
    }
    const out = normalizeTplFields(real)
    expect(Array.isArray(out)).toBe(true)
    expect(out.map((f) => f.key)).toEqual(["leaveType", "days"])
  })

  it("FLOW 形状含 _approvals 伪字段组 → 平铺并入", () => {
    const real = {
      fields: [{ key: "days", label: "天数" }],
      groups: [
        { label: "审批数据", fields: [{ key: "_approvals.0.assigneeName", label: "第1步办理人" }] },
      ],
    }
    expect(normalizeTplFields(real).map((f) => f.key)).toEqual(["days", "_approvals.0.assigneeName"])
  })

  it("mock 裸数组原样返回", () => {
    const arr = [{ key: "a", label: "A" }]
    expect(normalizeTplFields(arr)).toEqual(arr)
  })

  it("垃圾输入回空数组（绝不让 .map 崩页面）", () => {
    expect(normalizeTplFields(null)).toEqual([])
    expect(normalizeTplFields(undefined)).toEqual([])
    expect(normalizeTplFields("oops")).toEqual([])
    expect(normalizeTplFields({ fields: "not-array", groups: [{ fields: "x" }] })).toEqual([])
  })
})
