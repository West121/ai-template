/**
 * 批D 语音输入用例（亮点⑥）：特性检测（标准/webkit/无）+ 识别结果拼接。
 */
import { describe, expect, it } from "vitest"
import { getSpeechRecognitionCtor, isSpeechSupported, transcriptOf } from "./speech"

class FakeRecognition {}

describe("getSpeechRecognitionCtor / isSpeechSupported（特性检测）", () => {
  it("标准 SpeechRecognition 存在 → 命中", () => {
    const scope = { SpeechRecognition: FakeRecognition }
    expect(getSpeechRecognitionCtor(scope)).toBe(FakeRecognition)
    expect(isSpeechSupported(scope)).toBe(true)
  })

  it("仅 webkit 前缀 → 命中", () => {
    const scope = { webkitSpeechRecognition: FakeRecognition }
    expect(getSpeechRecognitionCtor(scope)).toBe(FakeRecognition)
    expect(isSpeechSupported(scope)).toBe(true)
  })

  it("都不存在 / 非函数 → null（按钮隐藏）", () => {
    expect(getSpeechRecognitionCtor({})).toBeNull()
    expect(getSpeechRecognitionCtor({ SpeechRecognition: 123 })).toBeNull()
    expect(getSpeechRecognitionCtor(undefined)).toBeNull()
    expect(isSpeechSupported({})).toBe(false)
  })
})

describe("transcriptOf（识别事件 → 文本）", () => {
  it("拼接多段 result 的首选转写并去空白", () => {
    const e = { results: [[{ transcript: "帮我" }], [{ transcript: "查待办 " }]] }
    expect(transcriptOf(e)).toBe("帮我查待办")
  })

  it("空结果 → 空串", () => {
    expect(transcriptOf({ results: [] })).toBe("")
  })
})
