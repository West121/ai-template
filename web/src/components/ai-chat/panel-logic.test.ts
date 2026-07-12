/**
 * 批D 面板纯逻辑用例：斜杠命令过滤（亮点⑥）+ 晨报当日关闭/汇总（亮点⑤）。
 */
import { describe, expect, it } from "vitest"
import { pickRestoreTarget } from "./panel-logic"
import {
  SLASH_COMMANDS,
  briefingSummary,
  filterSlashCommands,
  shouldShowBriefing,
  todayStr,
} from "./panel-logic"

describe("filterSlashCommands（斜杠命令过滤）", () => {
  it("非斜杠输入 → 空（不弹面板）", () => {
    expect(filterSlashCommands("")).toEqual([])
    expect(filterSlashCommands("你好")).toEqual([])
    expect(filterSlashCommands(" /待办")).toEqual([]) // 前导空格不算斜杠起手
  })

  it("只输入 '/' → 全量命令", () => {
    expect(filterSlashCommands("/")).toEqual(SLASH_COMMANDS)
  })

  it("按命令名匹配（去斜杠比较）", () => {
    const r = filterSlashCommands("/待办")
    expect(r.length).toBe(1)
    expect(r[0].cmd).toBe("/待办")
    expect(r[0].message).toBe("查我的待办")
  })

  it("按说明文案匹配（大小写不敏感）", () => {
    const r = filterSlashCommands("/统计")
    expect(r.some((c) => c.cmd === "/统计")).toBe(true)
  })

  it("无匹配 → 空数组", () => {
    expect(filterSlashCommands("/zzz不存在")).toEqual([])
  })

  it("/新会话 命令携带 action 而非 message", () => {
    const r = filterSlashCommands("/新会话")
    expect(r[0].action).toBe("new-session")
    expect(r[0].message).toBeUndefined()
  })
})

describe("todayStr / shouldShowBriefing（晨报当日关闭）", () => {
  it("todayStr 本地日期 YYYY-MM-DD 补零", () => {
    expect(todayStr(new Date(2026, 0, 5))).toBe("2026-01-05")
    expect(todayStr(new Date(2026, 11, 31))).toBe("2026-12-31")
  })

  it("当日已关闭 → 不展示；未关/关的是往日 → 展示（次日恢复）", () => {
    const today = "2026-07-12"
    expect(shouldShowBriefing(today, today)).toBe(false)
    expect(shouldShowBriefing("2026-07-11", today)).toBe(true) // 昨天关的，今天恢复
    expect(shouldShowBriefing(null, today)).toBe(true)
    expect(shouldShowBriefing(undefined, today)).toBe(true)
  })
})

describe("briefingSummary（晨报汇总行）", () => {
  it("只列非零项，中点分隔", () => {
    expect(briefingSummary({ urgentCount: 3, meetingCount: 2, unreadCount: 5 })).toBe("今日 3 件急事 · 2 个会议 · 5 条待阅")
    expect(briefingSummary({ urgentCount: 0, meetingCount: 1, unreadCount: 0 })).toBe("今日 1 个会议")
  })

  it("全 0 → 空串（组件走空态文案）", () => {
    expect(briefingSummary({ urgentCount: 0, meetingCount: 0, unreadCount: 0 })).toBe("")
    expect(briefingSummary({})).toBe("")
  })
})

describe("pickRestoreTarget（打开面板恢复上次会话）", () => {
  const list = [{ id: "s3" }, { id: "s2" }, { id: "s1" }] // 最近在前

  it("无历史（空列表）→ null（新会话·欢迎态）", () => {
    expect(pickRestoreTarget([], "s2")).toBeNull()
    expect(pickRestoreTarget(null, null)).toBeNull()
    expect(pickRestoreTarget(undefined, "sX")).toBeNull()
  })

  it("lastId 仍在列表 → 精确恢复上次会话", () => {
    expect(pickRestoreTarget(list, "s2")).toBe("s2")
  })

  it("无 lastId / lastId 已失效 → 最近一个（list[0]）", () => {
    expect(pickRestoreTarget(list, null)).toBe("s3")
    expect(pickRestoreTarget(list, "已删除的会话")).toBe("s3")
  })
})
