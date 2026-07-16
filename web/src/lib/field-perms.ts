/**
 * 角色×功能 字段权限（权限中心 P3，后端 V52 已上线可直连）。
 *
 * ── 契约（字段名钉死）────────────────────────────────────────────────────────
 *  GET /api/system/field-perms/catalog?feature= → {formFields:[{key,label,type?,group?}], fixedColumns:[{field,label}]}
 *  GET /api/system/roles/{id}/field-perms?feature= → [{feature,field,visible,editable}]
 *  PUT /api/system/roles/{id}/field-perms?feature=（按 feature 全量替换；body=[{field,visible,editable}]，
 *      editable=true && visible=false 后端 400——前端矩阵已联动禁用该组合）【system:role:edit】
 *  GET /api/system/field-perms/mine?feature= → {fields:{<field>:{visible,editable}}}（空对象=全可见全可编）
 *  feature 目录：GET /api/ai/features（featureCode 为 opaque 字符串）
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 渲染侧口径：**角色级(mine) 与 流程节点级 fieldPolicy 交集取更严**——visible=两层都可见、
 * editable=两层都可编；未列出的字段=全放行。前端过滤只是体验，后端脱敏是权威（红线）。
 * mine 按 feature 模块级缓存（登录期内稳定），`invalidateMineFieldPerms` 供角色配置变更后失效。
 */
import type { ColumnDef } from "@tanstack/react-table"
import { api, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import type { FieldPolicyMap } from "@/lib/form-manifest"
import type { FormPerms } from "@/pages/workflow/designer/types"

/* ============================ 类型 ============================ */

export interface FieldPermCatalog {
  formFields: { key: string; label: string; type?: string; group?: string }[]
  fixedColumns: { field: string; label: string }[]
}

export interface RoleFieldPermEntry {
  feature: string
  field: string
  visible: boolean
  editable: boolean
}

export interface MinePerm {
  visible: boolean
  editable: boolean
}

/** 当前用户在某功能上的字段权限（空对象=全可见全可编） */
export type MineFieldPerms = Record<string, MinePerm>

export interface AiFeatureItem {
  featureCode: string
  name: string
}

export interface DpResult<T> {
  data: T
  demo: boolean
}

/* ============================ 归一 ============================ */

function normArr<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === "object" && Array.isArray((raw as { list?: unknown }).list)) return (raw as { list: T[] }).list
  return []
}

function normCatalog(raw: unknown): FieldPermCatalog {
  const o = (raw ?? {}) as Partial<FieldPermCatalog>
  return {
    formFields: Array.isArray(o.formFields) ? o.formFields.filter((f) => f && typeof f.key === "string") : [],
    fixedColumns: Array.isArray(o.fixedColumns) ? o.fixedColumns.filter((c) => c && typeof c.field === "string") : [],
  }
}

function normMine(raw: unknown): MineFieldPerms {
  const fields = (raw as { fields?: unknown } | null)?.fields
  if (!fields || typeof fields !== "object") return {}
  const out: MineFieldPerms = {}
  for (const [k, v] of Object.entries(fields as Record<string, Partial<MinePerm>>)) {
    if (v && typeof v === "object") out[k] = { visible: v.visible !== false, editable: v.editable !== false }
  }
  return out
}

/* ============================ 演示态 ============================ */

const MOCK_ROLE_PERMS: Record<string, RoleFieldPermEntry[]> = {}

function mockCatalog(): FieldPermCatalog {
  return {
    formFields: [
      { key: "leaveType", label: "请假类型", type: "select", group: "基础字段" },
      { key: "days", label: "请假天数", type: "number", group: "基础字段" },
      { key: "reason", label: "事由", type: "textarea", group: "基础字段" },
    ],
    fixedColumns: [
      { field: "reason", label: "事由" },
      { field: "days", label: "时长（天）" },
    ],
  }
}

async function withMock<T>(fn: () => Promise<T>, m: () => T): Promise<DpResult<T>> {
  if (useAuthStore.getState().offline) return { data: m(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    // 收紧口径（V52 已上线）：仅网络不通降级演示；信封错误（含 404）照抛，避免掩盖真实故障
    if (err instanceof NetworkError) return { data: m(), demo: true }
    throw err
  }
}

/* ============================ 配置侧（角色抽屉用） ============================ */

export function fetchAiFeatures(): Promise<DpResult<AiFeatureItem[]>> {
  return withMock(
    () =>
      api<unknown>("/api/ai/features").then((r) =>
        normArr<{ featureCode?: unknown; name?: unknown }>(r)
          .map((f) => ({ featureCode: String(f.featureCode ?? ""), name: String(f.name ?? f.featureCode ?? "") }))
          .filter((f) => f.featureCode),
      ),
    () => [
      { featureCode: "WORKFLOW_TASKS", name: "我的审批" },
      { featureCode: "ATTENDANCE_LEAVE", name: "请假管理" },
    ],
  )
}

export function fetchFieldPermCatalog(feature: string): Promise<DpResult<FieldPermCatalog>> {
  return withMock(
    () => api<unknown>(`/api/system/field-perms/catalog?feature=${encodeURIComponent(feature)}`).then(normCatalog),
    () => mockCatalog(),
  )
}

export function fetchRoleFieldPerms(roleId: number, feature: string): Promise<DpResult<RoleFieldPermEntry[]>> {
  return withMock(
    () =>
      api<unknown>(`/api/system/roles/${roleId}/field-perms?feature=${encodeURIComponent(feature)}`).then((r) =>
        normArr<RoleFieldPermEntry>(r).filter((e) => e && typeof e.field === "string"),
      ),
    () => (MOCK_ROLE_PERMS[`${roleId}:${feature}`] ?? []).map((e) => ({ ...e })),
  )
}

/** PUT 入参：feature 走查询参数，body 条目只含 {field,visible,editable}（契约钉死） */
export type RoleFieldPermInput = Pick<RoleFieldPermEntry, "field" | "visible" | "editable">

/** 全量替换某功能的字段权限（只下发受限字段；全放行=不下发） */
export function saveRoleFieldPerms(roleId: number, feature: string, entries: RoleFieldPermInput[]): Promise<DpResult<boolean>> {
  const body: RoleFieldPermInput[] = entries.map((e) => ({ field: e.field, visible: e.visible, editable: e.editable }))
  return withMock(
    () =>
      api<void>(`/api/system/roles/${roleId}/field-perms?feature=${encodeURIComponent(feature)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }).then(() => true),
    () => {
      MOCK_ROLE_PERMS[`${roleId}:${feature}`] = body.map((e) => ({ feature, ...e }))
      return true
    },
  )
}

/** 测试用：清空演示配置 */
export function resetFieldPermsMock(): void {
  for (const k of Object.keys(MOCK_ROLE_PERMS)) delete MOCK_ROLE_PERMS[k]
}

/* ============================ 渲染侧（mine 缓存 + 过滤） ============================ */

const mineCache = new Map<string, Promise<MineFieldPerms>>()

/**
 * 当前用户在某功能上的合并字段权限（按 feature 缓存；拉取失败/未实现 → {} 全放行，静默不阻断渲染）。
 */
export function fetchMineFieldPerms(feature: string): Promise<MineFieldPerms> {
  if (useAuthStore.getState().offline) return Promise.resolve({})
  let p = mineCache.get(feature)
  if (!p) {
    p = api<unknown>(`/api/system/field-perms/mine?feature=${encodeURIComponent(feature)}`)
      .then(normMine)
      .catch(() => ({}) as MineFieldPerms)
    mineCache.set(feature, p)
  }
  return p
}

/** 失效缓存（角色字段权限变更/切换身份后调用；缺省全清） */
export function invalidateMineFieldPerms(feature?: string): void {
  if (feature) mineCache.delete(feature)
  else mineCache.clear()
}

/** 某字段的 mine 权限（未列出=全放行） */
export function minePermOf(mine: MineFieldPerms, field: string): MinePerm {
  return mine[field] ?? { visible: true, editable: true }
}

/**
 * 交集更严：节点级 fieldPolicy × 角色级 mine → 新 FieldPolicyMap。
 * visible=两层都可见；editable=两层都可编；required 沿节点层。mine 里受限但节点层未列的字段也并入
 * （节点层缺省=全放行，交集后取 mine 的限制）。两层皆空 → undefined（保持"未配置"语义）。
 */
export function intersectFieldPolicy(nodePolicy: FieldPolicyMap | undefined, mine: MineFieldPerms): FieldPolicyMap | undefined {
  const mineKeys = Object.keys(mine)
  if (!nodePolicy && mineKeys.length === 0) return undefined
  const out: FieldPolicyMap = {}
  for (const [key, p] of Object.entries(nodePolicy ?? {})) {
    const m = minePermOf(mine, key)
    out[key] = { visible: p.visible && m.visible, editable: p.editable && m.editable, required: p.required }
  }
  for (const key of mineKeys) {
    if (out[key]) continue
    const m = mine[key]
    out[key] = { visible: m.visible, editable: m.editable, required: false }
  }
  return out
}

/**
 * mine → FormRenderer 的 tri-state perms（在线表单）：受限字段映射 HIDDEN/READ，未列出不下发（=EDIT）。
 * 已有节点级 perms 时交集更严（任一 HIDDEN→HIDDEN；任一 READ→至多 READ）。
 */
export function intersectFormPerms(nodePerms: FormPerms | undefined, mine: MineFieldPerms): FormPerms | undefined {
  const out: FormPerms = { ...(nodePerms ?? {}) }
  for (const [key, m] of Object.entries(mine)) {
    const node = out[key] // undefined=EDIT
    const nodeVisible = node !== "HIDDEN"
    const nodeEditable = node === undefined || node === "EDIT"
    const visible = nodeVisible && m.visible
    const editable = nodeEditable && m.editable
    out[key] = !visible ? "HIDDEN" : !editable ? "READ" : "EDIT"
  }
  if (Object.keys(out).length === 0) return nodePerms
  return out
}

/** DataTable 列过滤：mine.visible=false 的固定列（按 accessorKey/id 匹配）整列隐藏 */
export function filterColumnsByMine<T>(columns: ColumnDef<T, unknown>[], mine: MineFieldPerms): ColumnDef<T, unknown>[] {
  if (Object.keys(mine).length === 0) return columns
  return columns.filter((c) => {
    const key = (c as { accessorKey?: string }).accessorKey ?? c.id
    if (!key) return true
    return minePermOf(mine, String(key)).visible
  })
}
