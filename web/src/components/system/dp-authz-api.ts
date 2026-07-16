/**
 * 多维数据权限授权 · API 层（DP1 + P2 功能级覆盖，permission-center.md 附3；契约钉死，磐石 V54 并行）。
 * 降级口径（收紧）：仅 offline / NetworkError → 演示数据 + banner；信封错误（含 404）照抛。
 * 响应三处归一（非数组→[]，防白屏）。
 *
 * ── 契约（前后端共用，字段名钉死）───────────────────────────────────────────────
 *  GET  /api/system/data-dimensions                 → [{code,label,entity?,enabled}]  已注册可配业务维度（不含内建 dept/self）
 *  GET  /api/system/data-dimensions/{code}/options  → [{id,label}]                    该维 CUSTOM 可选值（泛化，别硬编码各维 URL）
 *  GET  /api/system/roles/{id}/data-dimensions          → 全局层 [{dimension,scope,values}]
 *  GET  /api/system/roles/{id}/data-dimensions?all=1    → 全部层（行带 feature，''/缺省=全局行）
 *  PUT  /api/system/roles/{id}/data-dimensions?feature=X body=[{dimension,scope,values}]
 *       —— **按层替换**（V54 终稿）：只动该层，其它层天然不受影响；缺省/''=全局层；
 *          PUT [] = 清空该层（该功能回落全局）。**body 不带 feature**（以 query 为准；GET 回带容忍）。
 *  GET/PUT /api/system/users/{id}/data-dimensions   同结构
 *  dimension 可为业务维度 code 或内建 'dept'（组织/部门维，values=deptIds，**精确部门集**语义已确认；
 *  全局层不接受 dept——UI 不提供该路径，后端 400 兜底）。
 *  解析顺序：功能覆盖 > 全局 > 不限；**覆盖=替换**（只看覆盖层，不与全局并集）。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { api, NetworkError } from "@/lib/api"
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
  /** P2：''/缺省=全局层；非空=功能覆盖层（覆盖=替换，该功能脱离全局） */
  feature?: string
}

/** 内建「组织(部门)」维度键（覆盖层允许 dimension='dept'，values=deptIds） */
export const DEPT_DIMENSION = "dept"

/** 是否全局层行（feature 空/缺省） */
export function isGlobalRow(a: DimAuthz): boolean {
  return !a.feature
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
/** 演示默认授权：全局 costCenter=CUSTOM[1] + 一条功能覆盖示例（请假 · 部门维收窄） */
const MOCK_AUTHZ_DEFAULT: DimAuthz[] = [
  { dimension: "costCenter", scope: "CUSTOM", values: [1] },
  { feature: "ATTENDANCE_LEAVE", dimension: DEPT_DIMENSION, scope: "CUSTOM", values: [1] },
]
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
    // 收紧口径（P2）：仅网络不通降级演示；信封错误（含 404）照抛，避免掩盖真实故障
    if (err instanceof NetworkError) return { data: mock(), demo: true }
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

/** 全局层（不带 ?all）——DataDimensionAuthz 用；GET 若回带 feature 行由调用方过滤容忍 */
export function fetchAuthz(principalType: DpPrincipal, id: number): Promise<DpResult<DimAuthz[]>> {
  return withMock(
    () => api<DimAuthz[]>(authzPath(principalType, id)).then(normList<DimAuthz>),
    () => (MOCK_AUTHZ[authzKey(principalType, id)] ?? MOCK_AUTHZ_DEFAULT).filter(isGlobalRow),
  )
}

/** 全部层（?all=1，行带 feature；''/缺省=全局行）——按功能覆盖列表用 */
export function fetchAuthzAll(principalType: DpPrincipal, id: number): Promise<DpResult<DimAuthz[]>> {
  return withMock(
    () => api<DimAuthz[]>(`${authzPath(principalType, id)}?all=1`).then(normList<DimAuthz>),
    () => MOCK_AUTHZ[authzKey(principalType, id)] ?? MOCK_AUTHZ_DEFAULT,
  )
}

/**
 * 按层替换（V54 终稿）：PUT ?feature=X 只替换该层；feature 缺省/''=全局层；list=[] 清空该层。
 * body 条目不带 feature（以 query 为准）。
 */
export function saveAuthz(principalType: DpPrincipal, id: number, list: DimAuthz[], feature = ""): Promise<DpResult<boolean>> {
  const body = list.map((a) => ({ dimension: a.dimension, scope: a.scope, values: a.values }))
  const qs = feature ? `?feature=${encodeURIComponent(feature)}` : ""
  return withMock(
    () => api<void>(`${authzPath(principalType, id)}${qs}`, { method: "PUT", body: JSON.stringify(body) }).then(() => true),
    () => {
      const key = authzKey(principalType, id)
      const cur = MOCK_AUTHZ[key] ?? [...MOCK_AUTHZ_DEFAULT]
      const others = cur.filter((a) => (a.feature ?? "") !== feature)
      MOCK_AUTHZ[key] = [...others, ...body.map((a) => (feature ? { ...a, feature } : { ...a }))]
      return true
    },
  )
}
