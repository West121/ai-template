/**
 * extensions 组装工厂单测（契约 §6）：preset → feature 集合 → 扩展装配正确、分档能力不越级。
 * 纯逻辑（node 环境），不创建编辑器实例。
 */
import { describe, expect, it } from "vitest"
import {
  PRESET_FEATURES,
  buildExtensions,
  resolveFeatures,
  type RichTextFeature,
} from "./extensions"

function namesOf(features: RichTextFeature[], opts?: { maxLength?: number }): string[] {
  return buildExtensions(features, opts).map((e) => e.name)
}

describe("PRESET_FEATURES 分级", () => {
  it("standard 是 minimal 超集，full 是 standard 超集", () => {
    for (const f of PRESET_FEATURES.minimal) expect(PRESET_FEATURES.standard).toContain(f)
    for (const f of PRESET_FEATURES.standard) expect(PRESET_FEATURES.full).toContain(f)
  })

  it("minimal 面向意见/评论：无表格/图片/标题等重能力", () => {
    for (const f of ["table", "image", "taskList", "heading", "color"] as const) {
      expect(PRESET_FEATURES.minimal).not.toContain(f)
    }
  })
})

describe("buildExtensions 装配", () => {
  it("基础设施恒装：starterKit + placeholder + characterCount", () => {
    const names = namesOf(PRESET_FEATURES.minimal)
    expect(names).toContain("starterKit")
    expect(names).toContain("placeholder")
    expect(names).toContain("characterCount")
  })

  it("minimal 不装 standard/full 专属扩展", () => {
    const names = namesOf(PRESET_FEATURES.minimal)
    for (const n of ["textAlign", "highlight", "table", "image", "taskList", "subscript", "superscript", "color"]) {
      expect(names).not.toContain(n)
    }
  })

  it("standard 装对齐/高亮，但不装 full 专属（表格/图片/任务列表/上下标/颜色）", () => {
    const names = namesOf(PRESET_FEATURES.standard)
    expect(names).toContain("textAlign")
    expect(names).toContain("highlight")
    for (const n of ["table", "image", "taskList", "subscript", "superscript", "color"]) {
      expect(names).not.toContain(n)
    }
  })

  it("full 装齐表格（含行/表头/单元格）/ 图片 / 任务列表 / 上下标 / 颜色", () => {
    const names = namesOf(PRESET_FEATURES.full)
    for (const n of [
      "table",
      "tableRow",
      "tableHeader",
      "tableCell",
      "image",
      "taskList",
      "taskItem",
      "subscript",
      "superscript",
      "textStyle",
      "color",
    ]) {
      expect(names).toContain(n)
    }
  })

  it("starterKit 按 feature 关闭未启用项（minimal 关 heading/blockquote/link）", () => {
    const starter = buildExtensions(PRESET_FEATURES.minimal).find((e) => e.name === "starterKit")
    const options = starter?.options as Record<string, unknown>
    expect(options.heading).toBe(false)
    expect(options.blockquote).toBe(false)
    expect(options.link).toBe(false)
    // codeBlock 超出契约清单，恒关
    expect(options.codeBlock).toBe(false)
  })

  it("maxLength 透传给 CharacterCount.limit", () => {
    const cc = buildExtensions(PRESET_FEATURES.minimal, { maxLength: 2000 }).find(
      (e) => e.name === "characterCount",
    )
    expect(cc).toBeDefined()
    expect((cc!.options as { limit?: number }).limit).toBe(2000)
  })
})

describe("resolveFeatures", () => {
  it("features 优先于 preset；缺省 standard", () => {
    expect(resolveFeatures("full", ["bold"])).toEqual(["bold"])
    expect(resolveFeatures("minimal")).toEqual(PRESET_FEATURES.minimal)
    expect(resolveFeatures()).toEqual(PRESET_FEATURES.standard)
  })
})
