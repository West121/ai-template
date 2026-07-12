import { describe, it, expect } from "vitest"
import { ASSIST_ACTIONS, assistLabel, buildAssistText, isReplaceAction } from "./assist-util"

describe("assist-util", () => {
  it("六动作齐全；replace/needsSelection 标记正确", () => {
    expect(ASSIST_ACTIONS.map((a) => a.key)).toEqual(["continue", "polish", "proofread", "translate", "summarize", "outline"])
    expect(isReplaceAction("polish")).toBe(true)
    expect(isReplaceAction("proofread")).toBe(true)
    expect(isReplaceAction("translate")).toBe(true)
    expect(isReplaceAction("continue")).toBe(false)
    expect(isReplaceAction("summarize")).toBe(false)
    expect(ASSIST_ACTIONS.find((a) => a.key === "polish")!.needsSelection).toBe(true)
    expect(ASSIST_ACTIONS.find((a) => a.key === "continue")!.needsSelection).toBe(false)
    expect(assistLabel("outline")).toBe("生成大纲")
  })

  it("buildAssistText：各动作产出非空；替换类含选中文本", () => {
    expect(buildAssistText("continue")).toContain("落地节奏")
    expect(buildAssistText("summarize")).toContain("要点")
    expect(buildAssistText("outline")).toContain("一、")
    expect(buildAssistText("polish", "原始句子")).toContain("原始句子")
    expect(buildAssistText("proofread", "有错别字的句子")).toContain("有错别字的句子")
    expect(buildAssistText("translate", "你好")).toContain("你好")
    // 替换类无选区 → 引导提示（不抛）
    expect(buildAssistText("polish", "")).toContain("请先选中")
  })
})
