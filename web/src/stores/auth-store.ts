import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface UserInfo {
  name: string
  account: string
  avatar?: string
  /** 自助可改的安全字段（个人中心）——来自 /api/auth/me，磐石补齐 */
  email?: string
  phone?: string
  dept: string
  post: string
  roles: string[]
}

/** 一条任职：部门 + 岗位 + 角色集合；primary=主任职，否则为兼任 */
export interface AssignmentInfo {
  id: number
  deptId: number
  deptName: string
  postName: string
  roleNames: string[]
  primary: boolean
}

interface LoginData {
  token: string
  user: { id: number; username: string; name: string; email?: string; phone?: string; avatar?: string }
  assignments: AssignmentInfo[]
  activeAssignmentId: string
  permissions: string[]
}

interface AuthState {
  token: string | null
  user: UserInfo | null
  userId: number | null
  assignments: AssignmentInfo[]
  /** 当前激活身份："ALL" 或任职 id 字符串 */
  activeAssignmentId: string
  /** 功能权限码集合；null 表示离线演示模式（视为全部允许） */
  permissions: string[] | null
  /** 后端不可用时的离线演示模式 */
  offline: boolean
  /** 真实登录；后端不可达时自动降级为离线演示模式，返回 offline 标记 */
  login: (account: string, password: string) => Promise<{ offline: boolean }>
  /** 切换激活身份（主任职/兼任/全部身份），重新签发 token 并刷新数据权限 */
  switchAssignment: (assignmentId: string) => Promise<void>
  /** 用 /api/auth/me 刷新本地缓存的权限/任职（后端权限变更后无需重新登录） */
  refreshMe: () => Promise<void>
  /** 个人中心保存资料后就地合并本人安全字段（名字/头像变了顶栏也随之更新） */
  patchUser: (partial: Partial<UserInfo>) => void
  logout: () => void
}

function applyLoginData(data: LoginData) {
  const active =
    data.assignments.find((a) => String(a.id) === data.activeAssignmentId) ??
    data.assignments.find((a) => a.primary) ??
    data.assignments[0]
  return {
    token: data.token,
    userId: data.user.id,
    user: {
      name: data.user.name,
      account: data.user.username,
      avatar: data.user.avatar,
      email: data.user.email,
      phone: data.user.phone,
      dept: active?.deptName ?? "",
      post: active?.postName ?? "",
      roles: active?.roleNames ?? [],
    },
    assignments: data.assignments,
    activeAssignmentId: data.activeAssignmentId,
    permissions: data.permissions,
    offline: false,
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      userId: null,
      assignments: [],
      activeAssignmentId: "",
      permissions: null,
      offline: false,

      login: async (account, password) => {
        let res: Response
        try {
          res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: account, password }),
          })
        } catch {
          // 后端未启动：离线演示模式（保持模板开箱即用）
          set({
            token: `mock-token-${account}`,
            user: { name: "王经理", account, dept: "产品研发部", post: "部门经理", roles: ["admin"] },
            userId: null,
            assignments: [],
            activeAssignmentId: "",
            permissions: null,
            offline: true,
          })
          return { offline: true }
        }
        const body = (await res.json()) as { code: number; message?: string; data: LoginData }
        if (body.code !== 0) throw new Error(body.message ?? "登录失败")
        set(applyLoginData(body.data))
        return { offline: false }
      },

      switchAssignment: async (assignmentId) => {
        const { token } = get()
        const res = await fetch("/api/auth/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ assignmentId }),
        })
        const body = (await res.json()) as { code: number; message?: string; data: LoginData }
        if (body.code !== 0) throw new Error(body.message ?? "切换身份失败")
        set(applyLoginData(body.data))
      },

      refreshMe: async () => {
        const { token, offline } = get()
        if (!token || offline) return
        try {
          const res = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
          })
          const body = (await res.json()) as { code: number; data: Omit<LoginData, "token"> }
          if (body.code === 0 && body.data) {
            // /me 不返回 token，沿用现有 token
            set(applyLoginData({ ...body.data, token }))
          }
        } catch {
          // 网络异常时保持现状，由各页面的离线兜底处理
        }
      },

      patchUser: (partial) =>
        set((state) => (state.user ? { user: { ...state.user, ...partial } } : {})),

      logout: () =>
        set({
          token: null,
          user: null,
          userId: null,
          assignments: [],
          activeAssignmentId: "",
          permissions: null,
          offline: false,
        }),
    }),
    { name: "oa-auth" },
  ),
)

/** 功能权限判断：离线演示模式（permissions=null）视为全部允许 */
export function hasPerm(code: string): boolean {
  const { permissions } = useAuthStore.getState()
  if (permissions == null) return true
  return permissions.includes(code)
}

/** 响应式版本：在组件中订阅权限变化 */
export function useHasPerm(code: string): boolean {
  return useAuthStore((s) => s.permissions == null || s.permissions.includes(code))
}
