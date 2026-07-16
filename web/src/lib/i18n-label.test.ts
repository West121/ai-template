// @vitest-environment jsdom
/**
 * pickLabel 回退链（i18n M1 红线：任何输入不空白、非对象容错）+ localizeWidgets 零变化保证。
 */
import { describe, expect, it } from "vitest"
import type { FormWidget } from "@/types/workflow"
import { localizeWidgets, pickLabel } from "./i18n-label"

describe("pickLabel 回退链", () => {
  const i18n = { en: "Days", "zh-TW": "天數", th: "จำนวนวัน", ja: "日数" }

  it("zh-CN 恒取源 label（即使 labelI18n 里有值）", () => {
    expect(pickLabel(i18n, "zh-CN", "请假天数")).toBe("请假天数")
  })

  it("五语命中各取译文", () => {
    expect(pickLabel(i18n, "en", "请假天数")).toBe("Days")
    expect(pickLabel(i18n, "zh-TW", "请假天数")).toBe("天數")
    expect(pickLabel(i18n, "th", "请假天数")).toBe("จำนวนวัน")
    expect(pickLabel(i18n, "ja", "请假天数")).toBe("日数")
  })

  it("缺翻回退中文：labelI18n 缺省 / 缺该语言 / 空串 / 纯空白", () => {
    expect(pickLabel(undefined, "en", "请假天数")).toBe("请假天数")
    expect(pickLabel({ ja: "日数" }, "en", "请假天数")).toBe("请假天数")
    expect(pickLabel({ en: "" }, "en", "请假天数")).toBe("请假天数")
    expect(pickLabel({ en: "   " }, "en", "请假天数")).toBe("请假天数")
  })

  it("非对象容错（红线 2）：字符串/数组/null/数字值一律回退中文", () => {
    expect(pickLabel("garbage", "en", "请假天数")).toBe("请假天数")
    expect(pickLabel(["en"], "en", "请假天数")).toBe("请假天数")
    expect(pickLabel(null, "en", "请假天数")).toBe("请假天数")
    expect(pickLabel({ en: 123 }, "en", "请假天数")).toBe("请假天数")
  })
})

describe("localizeWidgets", () => {
  const widgets: FormWidget[] = [
    { id: "w1", type: "input", label: "请假天数", labelI18n: { en: "Days" } },
    {
      id: "g1",
      type: "group",
      label: "分组",
      children: [{ id: "w2", type: "input", label: "事由", labelI18n: { en: "Reason" } }],
    },
  ]

  it("zh-CN → 原引用返回（缺省渲染零变化）", () => {
    expect(localizeWidgets(widgets, "zh-CN")).toBe(widgets)
  })

  it("树内无任何 labelI18n → 原引用返回（旧 schema 零开销）", () => {
    const plain: FormWidget[] = [{ id: "w1", type: "input", label: "请假天数" }]
    expect(localizeWidgets(plain, "en")).toBe(plain)
  })

  it("en → label 物化为译文，children 递归；缺翻字段保持中文", () => {
    const mixed: FormWidget[] = [...widgets, { id: "w3", type: "input", label: "备注" }]
    const out = localizeWidgets(mixed, "en")
    expect(out[0].label).toBe("Days")
    expect(out[1].children?.[0].label).toBe("Reason")
    expect(out[2].label).toBe("备注")
    // 原数组不被改写
    expect(mixed[0].label).toBe("请假天数")
  })
})
