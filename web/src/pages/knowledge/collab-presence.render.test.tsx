// @vitest-environment jsdom
/** 协同在线状态条 冒烟：三态文案 + 在线用户头像（光标色/首字母）。 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { CollabPresence } from "./collab-presence"
import type { KbOnlineUser } from "./use-kb-collab"

afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const users: KbOnlineUser[] = [
  { clientId: 1, name: "张三", color: "#f97316" },
  { clientId: 2, name: "李四", color: "#0ea5e9" },
]

describe("CollabPresence", () => {
  it("connected → 协同编辑 · N 人在线 + 头像", () => {
    render(<CollabPresence status="connected" users={users} />)
    expect(screen.getByText(/协同编辑 · 2 人在线/)).toBeTruthy()
    expect(screen.getByTitle("张三")).toBeTruthy()
    expect(screen.getByTitle("李四")).toBeTruthy()
  })
  it("degraded → 单人编辑", () => {
    render(<CollabPresence status="degraded" users={[]} />)
    expect(screen.getByText("单人编辑")).toBeTruthy()
  })
  it("connecting → 连接协同中…", () => {
    render(<CollabPresence status="connecting" users={[]} />)
    expect(screen.getByText(/连接协同中/)).toBeTruthy()
  })
})
