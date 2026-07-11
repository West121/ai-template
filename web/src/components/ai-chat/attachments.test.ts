/**
 * §11 多模态附件校验纯函数用例（类型/大小准入 + 视觉能力检测）。
 */
import { describe, expect, it } from "vitest"
import { checkAttachmentFile, extOf, formatBytes, needsVisionWarning } from "./attachments"
import type { AiModelOption } from "./types"

const MB = 1024 * 1024

describe("checkAttachmentFile（就地准入校验）", () => {
  it("图片 png/jpg/webp ≤5MB 通过，kind=IMAGE", () => {
    expect(checkAttachmentFile("发票.png", "image/png", 2 * MB)).toEqual({ ok: true, kind: "IMAGE" })
    expect(checkAttachmentFile("照片.jpg", "image/jpeg", 5 * MB)).toEqual({ ok: true, kind: "IMAGE" })
    expect(checkAttachmentFile("截图.webp", "image/webp", 100)).toEqual({ ok: true, kind: "IMAGE" })
  })

  it("图片超 5MB 拒绝并给出文件名与体积", () => {
    const r = checkAttachmentFile("大图.png", "image/png", 6 * MB)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain("大图.png")
      expect(r.reason).toContain("5MB")
    }
  })

  it("文本类 txt/md/csv/json/log ≤1MB 通过，kind=TEXT；超限拒绝", () => {
    expect(checkAttachmentFile("notes.md", "text/markdown", 1024)).toEqual({ ok: true, kind: "TEXT" })
    expect(checkAttachmentFile("data.CSV", "text/csv", 1 * MB)).toEqual({ ok: true, kind: "TEXT" })
    expect(checkAttachmentFile("app.log", "", 500)).toEqual({ ok: true, kind: "TEXT" })
    const over = checkAttachmentFile("big.json", "application/json", 2 * MB)
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toContain("1MB")
  })

  it("pdf/docx 本批不支持：专门文案（就地提示）", () => {
    const pdf = checkAttachmentFile("合同.pdf", "application/pdf", 1024)
    expect(pdf.ok).toBe(false)
    if (!pdf.ok) expect(pdf.reason).toContain("PDF")
    const docx = checkAttachmentFile("方案.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024)
    expect(docx.ok).toBe(false)
    if (!docx.ok) expect(docx.reason).toContain("DOCX")
  })

  it("未知类型拒绝", () => {
    const r = checkAttachmentFile("archive.zip", "application/zip", 100)
    expect(r.ok).toBe(false)
  })
})

describe("needsVisionWarning（附图 × 模型视觉能力）", () => {
  const vision: AiModelOption = { credentialId: 2, name: "GPT-4o", model: "gpt-4o", supportsVision: true }
  const textOnly: AiModelOption = { credentialId: 1, name: "DeepSeek", model: "deepseek-chat", supportsVision: false }

  it("带图片 + 模型不支持视觉 → true（就地提示引导切换）", () => {
    expect(needsVisionWarning([{ kind: "IMAGE" }], textOnly)).toBe(true)
  })

  it("支持视觉 / 无图片 / 默认模型（未知能力，交后端 400） → false", () => {
    expect(needsVisionWarning([{ kind: "IMAGE" }], vision)).toBe(false)
    expect(needsVisionWarning([{ kind: "TEXT" }], textOnly)).toBe(false)
    expect(needsVisionWarning([{ kind: "IMAGE" }], null)).toBe(false)
  })
})

describe("辅助函数", () => {
  it("extOf / formatBytes", () => {
    expect(extOf("a.b.LOG")).toBe("log")
    expect(extOf("noext")).toBe("")
    expect(formatBytes(512)).toBe("512B")
    expect(formatBytes(2048)).toBe("2KB")
    expect(formatBytes(3.5 * MB)).toBe("3.5MB")
  })
})
