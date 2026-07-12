import { describe, it, expect } from "vitest"
import { kbWsBase, pickCollabColor } from "./use-kb-collab"

describe("use-kb-collab helpers", () => {
  it("kbWsBase：http→ws、https→wss，拼到 /ws/kb/doc", () => {
    expect(kbWsBase({ protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws/kb/doc")
    expect(kbWsBase({ protocol: "https:", host: "oa.example.com" })).toBe("wss://oa.example.com/ws/kb/doc")
  })

  it("pickCollabColor：确定性、同 seed 同色、越界取模、负数与小数安全", () => {
    expect(pickCollabColor(0)).toBe(pickCollabColor(0))
    expect(pickCollabColor(0)).not.toBe(pickCollabColor(1))
    expect(pickCollabColor(8)).toBe(pickCollabColor(0)) // 8 色循环
    expect(typeof pickCollabColor(-3)).toBe("string")
    expect(pickCollabColor(2.7)).toBe(pickCollabColor(2))
  })
})
