import { useAuthStore } from "@/stores/auth-store"

/** 后端统一响应结构（见 server/oa-common R<T>） */
interface ApiEnvelope<T> {
  code: number
  message?: string
  data: T
}

export class ApiError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

/** 网络层错误（后端未启动等），调用方可据此降级为离线演示模式 */
export class NetworkError extends Error {}

export interface PageResult<T> {
  list: T[]
  total: number
  pageNum: number
  pageSize: number
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { token, offline } = useAuthStore.getState()
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token && !offline ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new NetworkError("无法连接后端服务")
  }

  if (res.status === 401) {
    useAuthStore.getState().logout()
    window.location.href = "/login"
    throw new ApiError(401, "登录已过期，请重新登录")
  }

  let body: ApiEnvelope<T>
  try {
    body = (await res.json()) as ApiEnvelope<T>
  } catch {
    throw new ApiError(res.status, `请求失败（HTTP ${res.status}）`)
  }
  if (res.status === 403) throw new ApiError(403, body.message ?? "没有操作权限")
  if (body.code !== 0) throw new ApiError(body.code, body.message ?? "请求失败")
  return body.data
}
