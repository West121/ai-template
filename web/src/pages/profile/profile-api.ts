/**
 * 个人中心 · 自助 API 层（磐石补后端，契约钉死）。mock 先行：offline/404/NetworkError → 演示态 + demo；
 * 真实业务错（改密码原密码错 → envelope code 400）**照抛**，页面据此在原密码框高亮。
 *
 * ── 契约（字段名照用）──────────────────────────────────────────────────────────
 *  GET  /api/auth/me → {user:{id,username,name,email?,phone?,avatar?,dept?,post?}, assignments[], permissions[]}
 *  POST /api/auth/change-password {oldPassword,newPassword} → ok；原密码错 → 400（message"原密码错误"）
 *  PUT  /api/auth/profile {nickname?,phone?,email?,avatar?} → 更新后的 user（仅本人安全字段）
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

export interface MeUser {
  id?: number
  username?: string
  name: string
  email?: string
  phone?: string
  avatar?: string
  dept?: string
  post?: string
}
export interface MeResponse {
  user: MeUser
  assignments?: unknown[]
  permissions?: string[] | null
}
export interface ProfileInput {
  nickname?: string
  phone?: string
  email?: string
  avatar?: string
}
export interface ChangePasswordInput {
  oldPassword: string
  newPassword: string
}
export interface DpResult<T> {
  data: T
  demo: boolean
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<DpResult<T>> {
  if (useAuthStore.getState().offline) return { data: mock(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    // 端点未实现(404) / 网络不通 → 演示降级；真实业务错（原密码错 400 / 无权 403）照抛
    if (err instanceof NetworkError) return { data: mock(), demo: true }
    if (err instanceof ApiError && err.code === 404) return { data: mock(), demo: true }
    throw err
  }
}

/** 从 auth-store 兜底出一个 MeUser（后端未连时演示用） */
function meFromStore(): MeUser {
  const u = useAuthStore.getState().user
  return {
    name: u?.name ?? "访客",
    username: u?.account,
    email: u?.email,
    phone: u?.phone,
    avatar: u?.avatar,
    dept: u?.dept,
    post: u?.post,
  }
}

export function fetchMe(): Promise<DpResult<MeResponse>> {
  return withMock(
    () => api<MeResponse>("/api/auth/me"),
    () => ({ user: meFromStore(), assignments: useAuthStore.getState().assignments, permissions: useAuthStore.getState().permissions }),
  )
}

export function updateProfile(input: ProfileInput): Promise<DpResult<MeUser>> {
  return withMock(
    () => api<MeUser>("/api/auth/profile", { method: "PUT", body: JSON.stringify(input) }),
    () => {
      // 演示：把改动并回当前用户
      const cur = meFromStore()
      return {
        ...cur,
        name: input.nickname?.trim() || cur.name,
        phone: input.phone ?? cur.phone,
        email: input.email ?? cur.email,
        avatar: input.avatar ?? cur.avatar,
      }
    },
  )
}

export function changePassword(input: ChangePasswordInput): Promise<DpResult<boolean>> {
  return withMock(
    () => api<void>("/api/auth/change-password", { method: "POST", body: JSON.stringify(input) }).then(() => true),
    () => true, // 离线演示成功
  )
}
