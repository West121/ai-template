/**
 * 知识库权限 纯函数（可单测），对齐 docs/design/ai-knowledge-base.md §5。
 *  - 可见性：PUBLIC 全员 / INTERNAL 登录用户 / PRIVATE 仅成员（或 owner）。
 *  - 角色：owner → ADMIN；命中成员 principal(USER/DEPT/ROLE) → 该成员角色；否则 null（不可见/仅按可见性只读）。
 *  - offline（演示）：放开为 ADMIN，让无后端时可完整体验（与 auth-store permissions===null 允许全部同口径）。
 * 红线：AI 检索/推荐（批2）只在"可见空间"内做，越权不泄露 —— canSeeSpace 是那道闸。
 */
import type { KbMemberRole, KbSpace, KbSpaceMember, KbUserCtx } from "./types"

/** 成员 principal 是否命中当前用户（USER=本人 / DEPT=所在部门 / ROLE=拥有角色） */
function matchesCtx(m: KbSpaceMember, ctx: KbUserCtx): boolean {
  if (m.principalType === "USER") return ctx.userId != null && m.principalId === ctx.userId
  if (m.principalType === "DEPT") return ctx.deptIds.includes(m.principalId)
  if (m.principalType === "ROLE") return ctx.roleIds.includes(m.principalId)
  return false
}

/** 当前用户在空间的角色；不属于成员且非 owner → null */
export function roleOf(space: KbSpace, members: KbSpaceMember[], ctx: KbUserCtx): KbMemberRole | null {
  if (ctx.offline) return "ADMIN" // 演示放开
  if (ctx.userId != null && space.ownerId === ctx.userId) return "ADMIN"
  const mine = (Array.isArray(members) ? members : []).filter((m) => m.spaceId === space.id && matchesCtx(m, ctx))
  if (mine.length === 0) return null
  // 命中多条取最高权限
  const rank: Record<KbMemberRole, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3 }
  return mine.reduce((best, m) => (rank[m.role] > rank[best] ? m.role : best), "VIEWER" as KbMemberRole)
}

/** 空间是否对当前用户可见（列表过滤 / 进入闸门） */
export function canSeeSpace(space: KbSpace, members: KbSpaceMember[], ctx: KbUserCtx): boolean {
  if (ctx.offline) return true
  if (space.visibility === "PUBLIC") return true
  if (space.visibility === "INTERNAL") return ctx.userId != null
  // PRIVATE：owner 或成员
  return roleOf(space, members, ctx) != null
}

/** EDITOR / ADMIN 可编辑文档 */
export function canEdit(role: KbMemberRole | null): boolean {
  return role === "EDITOR" || role === "ADMIN"
}

/** 仅 ADMIN 可管理空间（成员/可见性/删除） */
export function canManage(role: KbMemberRole | null): boolean {
  return role === "ADMIN"
}

/** 从可见空间过滤（列表页用） */
export function visibleSpaces(spaces: KbSpace[], membersOf: (spaceId: number) => KbSpaceMember[], ctx: KbUserCtx): KbSpace[] {
  return (Array.isArray(spaces) ? spaces : []).filter((s) => canSeeSpace(s, membersOf(s.id), ctx))
}
