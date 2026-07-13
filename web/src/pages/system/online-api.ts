/**
 * 在线用户 · API 层（磐石做后端：Redis 会话 + JWT 会话 id + 过滤器 + 踢下线，契约钉死）。
 * mock 先行：offline/404/NetworkError → 演示会话 + demo；真实业务错（踢自己 → 400）**照抛**。
 * 列表响应归一（非数组 → []，防白屏）。
 *
 * ── 契约（字段名照用）──────────────────────────────────────────────────────────
 *  GET  /api/system/online → [{sessionId,userId,username,name,ip,location,client,loginTime,lastActive,current}]
 *       location=ip2region 归属地；client=UA 粗解析（浏览器·系统）；current=是否本人当前会话
 *  POST /api/system/online/{sessionId}/kick → ok；踢自己当前会话 → 400
 *  权限：system:online:list（页/列表）、system:online:kick（踢下线）
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

export interface OnlineSession extends Record<string, unknown> {
  sessionId: string
  userId: number
  username: string
  name: string
  ip: string
  location: string
  client: string
  loginTime: string
  lastActive: string
  current: boolean
}
export interface DpResult<T> {
  data: T
  demo: boolean
}

/** 列表归一：只接受数组，其它一律 []（防白屏第 2 层） */
export function normList(raw: unknown): OnlineSession[] {
  if (Array.isArray(raw)) return raw as OnlineSession[]
  if (raw && typeof raw === "object" && Array.isArray((raw as { list?: unknown }).list)) {
    return (raw as { list: OnlineSession[] }).list
  }
  return []
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<DpResult<T>> {
  if (useAuthStore.getState().offline) return { data: mock(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    if (err instanceof NetworkError) return { data: mock(), demo: true }
    if (err instanceof ApiError && err.code === 404) return { data: mock(), demo: true }
    throw err
  }
}

/* ---------------- 演示态（后端未连接） ---------------- */
function demoSessions(): OnlineSession[] {
  const now = new Date()
  const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60000).toISOString().slice(0, 19).replace("T", " ")
  const u = useAuthStore.getState().user
  return [
    { sessionId: "sess-current", userId: 1, username: u?.account ?? "admin", name: u?.name ?? "系统管理员", ip: "127.0.0.1", location: "内网 IP", client: "Chrome · Windows", loginTime: iso(42), lastActive: iso(0), current: true },
    { sessionId: "sess-2001", userId: 3, username: "zhangsan", name: "张三", ip: "112.10.238.77", location: "浙江省杭州市 · 电信", client: "Safari · macOS", loginTime: iso(88), lastActive: iso(3), current: false },
    { sessionId: "sess-2002", userId: 8, username: "manager", name: "王经理", ip: "39.156.66.10", location: "北京市 · 联通", client: "Edge · Windows", loginTime: iso(15), lastActive: iso(1), current: false },
  ]
}

export function fetchOnline(): Promise<DpResult<OnlineSession[]>> {
  return withMock(
    () => api<OnlineSession[]>("/api/system/online").then((r) => normList(r)),
    () => demoSessions(),
  )
}

export function kickSession(sessionId: string): Promise<DpResult<boolean>> {
  return withMock(
    () => api<void>(`/api/system/online/${sessionId}/kick`, { method: "POST" }).then(() => true),
    () => true, // 离线演示成功
  )
}
