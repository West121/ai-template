/**
 * 转岗（DP3）· API 层（后端 DP3a 已上线，契约钉死）。mock 先行：offline/404/NetworkError → 演示成功 + demo；
 * 真实业务错（离职用户拒转岗 / 无权）**照抛**（弹层 toast）。
 *
 * ── 契约（字段名照用）──────────────────────────────────────────────────────────
 *  POST /api/system/users/{id}/transfer  {deptId, postId, roleIds?, retentionDays?}
 *       → {assignmentId, oldDeptId, newDeptId, retentionUntil}
 *  语义：原地变更主任职（换部门/岗位/角色）；retentionDays = 旧部门数据保留天数
 *       （留空=全局默认、0=不保留）；retentionUntil = 保留到期时间（可空）。
 *  权限：system:user:edit；离职用户拒转岗。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

export interface TransferInput {
  deptId: number
  postId: number
  roleIds?: number[]
  /** 旧部门数据保留天数：undefined=系统默认、0=不保留 */
  retentionDays?: number
}
export interface TransferResult {
  assignmentId: number
  oldDeptId: number
  newDeptId: number
  /** 保留到期时间（可空：0 天或后端未设时为空） */
  retentionUntil?: string | null
}
export interface DpResult<T> {
  data: T
  demo: boolean
}

const BASE = "/api/system"

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<DpResult<T>> {
  if (useAuthStore.getState().offline) return { data: mock(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    // 端点未实现(404) / 网络不通 → 演示降级；真实业务错（离职拒转岗 / 403 无权）照抛
    if (err instanceof NetworkError) return { data: mock(), demo: true }
    if (err instanceof ApiError && err.code === 404) return { data: mock(), demo: true }
    throw err
  }
}

/** 演示保留到期（后端未连时按 retentionDays 估算，仅用于回显提示） */
function demoRetentionUntil(retentionDays?: number): string | null {
  if (retentionDays === 0) return null // 0=不保留
  const days = retentionDays ?? 30 // 留空 → 演示按系统默认 30 天
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function transferUser(userId: number, input: TransferInput): Promise<DpResult<TransferResult>> {
  return withMock(
    () => api<TransferResult>(`${BASE}/users/${userId}/transfer`, { method: "POST", body: JSON.stringify(input) }),
    () => ({
      assignmentId: Math.floor(Math.random() * 100000),
      oldDeptId: 0,
      newDeptId: input.deptId,
      retentionUntil: demoRetentionUntil(input.retentionDays),
    }),
  )
}
