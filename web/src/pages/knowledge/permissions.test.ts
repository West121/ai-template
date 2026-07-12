import { describe, it, expect } from "vitest"
import { canEdit, canManage, canSeeSpace, roleOf, visibleSpaces } from "./permissions"
import type { KbSpace, KbSpaceMember, KbUserCtx, KbVisibility } from "./types"

const space = (id: number, visibility: KbVisibility, ownerId: number): KbSpace => ({ id, name: `s${id}`, code: `S${id}`, visibility, ownerId, memberCount: 0 })
const ctx = (o: Partial<KbUserCtx>): KbUserCtx => ({ userId: null, deptIds: [], roleIds: [], offline: false, ...o })

const members: KbSpaceMember[] = [
  { id: 1, spaceId: 1, principalType: "USER", principalId: 7, principalName: "u7", role: "EDITOR" },
  { id: 2, spaceId: 1, principalType: "DEPT", principalId: 20, principalName: "d20", role: "VIEWER" },
  { id: 3, spaceId: 1, principalType: "ROLE", principalId: 30, principalName: "r30", role: "ADMIN" },
]

describe("knowledge permissions", () => {
  it("canSeeSpace：PUBLIC 全员 / INTERNAL 登录 / PRIVATE 仅成员 / offline 放开", () => {
    expect(canSeeSpace(space(1, "PUBLIC", 9), [], ctx({}))).toBe(true)
    expect(canSeeSpace(space(1, "INTERNAL", 9), [], ctx({}))).toBe(false) // 未登录
    expect(canSeeSpace(space(1, "INTERNAL", 9), [], ctx({ userId: 7 }))).toBe(true)
    expect(canSeeSpace(space(1, "PRIVATE", 9), members, ctx({ userId: 7 }))).toBe(true) // 成员
    expect(canSeeSpace(space(1, "PRIVATE", 9), members, ctx({ userId: 99 }))).toBe(false) // 非成员
    expect(canSeeSpace(space(1, "PRIVATE", 9), [], ctx({ offline: true }))).toBe(true) // 演示放开
  })

  it("roleOf：owner→ADMIN / USER·DEPT·ROLE 命中 / 非成员 null / 取最高 / offline→ADMIN", () => {
    expect(roleOf(space(1, "PRIVATE", 7), members, ctx({ userId: 7 }))).toBe("ADMIN") // owner 优先
    expect(roleOf(space(1, "PRIVATE", 9), members, ctx({ userId: 7 }))).toBe("EDITOR") // USER
    expect(roleOf(space(1, "PRIVATE", 9), members, ctx({ deptIds: [20] }))).toBe("VIEWER") // DEPT
    expect(roleOf(space(1, "PRIVATE", 9), members, ctx({ roleIds: [30] }))).toBe("ADMIN") // ROLE
    expect(roleOf(space(1, "PRIVATE", 9), members, ctx({ userId: 7, roleIds: [30] }))).toBe("ADMIN") // 取最高
    expect(roleOf(space(1, "PRIVATE", 9), members, ctx({ userId: 99 }))).toBeNull()
    expect(roleOf(space(1, "PRIVATE", 9), [], ctx({ offline: true }))).toBe("ADMIN")
  })

  it("canEdit / canManage", () => {
    expect(canEdit("EDITOR")).toBe(true)
    expect(canEdit("ADMIN")).toBe(true)
    expect(canEdit("VIEWER")).toBe(false)
    expect(canEdit(null)).toBe(false)
    expect(canManage("ADMIN")).toBe(true)
    expect(canManage("EDITOR")).toBe(false)
  })

  it("visibleSpaces：PUBLIC 保留 / PRIVATE 无成员剔除", () => {
    const spaces = [space(1, "PUBLIC", 9), space(2, "PRIVATE", 9)]
    const asMember = (sid: number): KbSpaceMember[] =>
      sid === 2 ? [{ id: 9, spaceId: 2, principalType: "USER", principalId: 7, principalName: "u", role: "VIEWER" }] : []
    expect(visibleSpaces(spaces, asMember, ctx({ userId: 7 })).map((s) => s.id)).toEqual([1, 2])
    expect(visibleSpaces(spaces, () => [], ctx({ userId: 7 })).map((s) => s.id)).toEqual([1]) // PRIVATE 无成员
  })
})
