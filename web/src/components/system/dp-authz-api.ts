/**
 * 多维数据权限授权 · API 层（DP1，docs/design/data-permission-advanced.md §一/§四；契约钉死）。
 * mock 先行：后端未上线（offline / 404 未实现 / NetworkError）→ 演示两个维度 + 演示授权，banner 降级；
 * 真实业务错（403 无权等）照抛。响应三处归一（非数组→[]，防白屏）。
 *
 * ── 契约（前后端共用，字段名钉死）───────────────────────────────────────────────
 *  GET  /api/system/data-dimensions                 → [{code,label,entity?,enabled}]  已注册可配业务维度（不含内建 dept/self）
 *  GET  /api/system/data-dimensions/{code}/options  → [{id,label}]                    该维 CUSTOM 可选值（泛化，别硬编码各维 URL）
 *  GET  /api/system/roles/{id}/data-dimensions      → [{dimension,scope:"ALL"|"CUSTOM",values:number[]}]
 *  PUT  /api/system/roles/{id}/data-dimensions      body 同上（全量替换）
 *  GET/PUT /api/system/users/{id}/data-dimensions   同结构
 *  语义：未配的维度=不限该维；scope=ALL 该维不限；CUSTOM=仅 values 集内可见。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

export interface DataDimension {
  code: string
  label: string
  entity?: string
  enabled?: boolean
}
/** RecordPicker 泛型要求 Record<string,unknown> → 加索引签名 */
export interface DimOption extends Record<string, unknown> {
  id: number
  label: string
}
export type DimScope = "ALL" | "CUSTOM"
export interface DimAuthz {
  dimension: string
  scope: DimScope
  values: number[]
}
export type DpPrincipal = "role" | "user"
export interface DpResult<T> {
  data: T
  demo: boolean
}

const BASE = "/api/system"

/* ---------------- 演示数据（后端未上线） ---------------- */
const MOCK_DIMS: DataDimension[] = [
  { code: "costCenter", label: "成本中心", enabled: true },
  { code: "project", label: "项目", enabled: true },
]
const MOCK_OPTIONS: Record<string, DimOption[]> = {
  costCenter: [
    { id: 1, label: "研发中心" },
    { id: 2, label: "市场部" },
  ],
  project: [
    { id: 101, label: "项目A" },
    { id: 102, label: "项目B" },
  ],
}
const MOCK_AUTHZ: Record<string, DimAuthz[]> = {}
const authzKey = (p: DpPrincipal, id: number) => `${p}:${id}`

function normList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === "object" && Array.isArray((raw as { list?: unknown }).list)) return (raw as { list: T[] }).list
  return []
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<DpResult<T>> {
  if (useAuthStore.getState().offline) return { data: mock(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    // 端点未实现(404) / 网络不通 → 演示降级；真实业务错(403 等) 照抛
    if (err instanceof NetworkError) return { data: mock(), demo: true }
    if (err instanceof ApiError && err.code === 404) return { data: mock(), demo: true }
    throw err
  }
}

const authzPath = (p: DpPrincipal, id: number) => `${BASE}/${p === "role" ? "roles" : "users"}/${id}/data-dimensions`

export function fetchDimensions(): Promise<DpResult<DataDimension[]>> {
  return withMock(
    () => api<DataDimension[]>(`${BASE}/data-dimensions`).then(normList<DataDimension>),
    () => MOCK_DIMS.filter((d) => d.enabled !== false),
  )
}

export function fetchDimensionOptions(code: string): Promise<DpResult<DimOption[]>> {
  return withMock(
    () => api<DimOption[]>(`${BASE}/data-dimensions/${encodeURIComponent(code)}/options`).then(normList<DimOption>),
    () => MOCK_OPTIONS[code] ?? [],
  )
}

export function fetchAuthz(principalType: DpPrincipal, id: number): Promise<DpResult<DimAuthz[]>> {
  return withMock(
    () => api<DimAuthz[]>(authzPath(principalType, id)).then(normList<DimAuthz>),
    () => MOCK_AUTHZ[authzKey(principalType, id)] ?? [{ dimension: "costCenter", scope: "CUSTOM", values: [1] }],
  )
}

export function saveAuthz(principalType: DpPrincipal, id: number, list: DimAuthz[]): Promise<DpResult<boolean>> {
  return withMock(
    () => api<void>(authzPath(principalType, id), { method: "PUT", body: JSON.stringify(list) }).then(() => true),
    () => {
      MOCK_AUTHZ[authzKey(principalType, id)] = list
      return true
    },
  )
}
