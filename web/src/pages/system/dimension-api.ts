/**
 * 数据维度管理 · API 层（权限中心 P1，磐石 V51 并行，契约钉死 mock 先行）。
 * withMock/normList 范式：offline/404/NetworkError → 演示维度（三种 valueSource 各一）+ demo；
 * 真实业务错照抛——删除被授权引用 → 409（提示先解除授权）。
 *
 * ── 契约（字段名钉死）────────────────────────────────────────────────────────
 *  GET    /api/system/data-dimensions?all=1（管理口径：含停用行；缺省仅启用=授权 UI 兼容）
 *         → [{code,label,enabled,valueSource:"OPTION"|"DICT"|"DEPT"|"PROVIDER",dictType?,bindings:[{entity,column}],builtin?}]
 *  POST   /api/system/data-dimensions        {code,label,valueSource,dictType?,bindings}
 *  PUT    /api/system/data-dimensions/{code} {label,enabled,dictType,bindings}（code/valueSource 不可改）
 *  DELETE /api/system/data-dimensions/{code}（软删；有授权引用 → 409）
 *  GET    /{code}/option-items【manage】→ [{id(行PK),value,label,sort,enabled}]（含禁用，精确回显）
 *  POST   /{code}/options {value?(缺省自增),label*,sort?,enabled?}（重值 409）
 *  PUT    /{code}/options/{id}（路径=行PK；body {label?,sort?,enabled?}；value 不可改）
 *  DELETE /{code}/options/{id}
 *  授权侧 GET /{code}/options（{id=授权值,label}）不变
 *  GET    /api/system/data-dimensions/bindable-entities → [{entity,label,columns:[{column,label}]}]
 *  错误口径：400/404/409 均走信封 body.code（仅权限门 HTTP 403）
 *  权限：system:dim:manage
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

export type DimValueSource = "OPTION" | "DICT" | "DEPT" | "PROVIDER"

export interface DimBinding {
  entity: string
  column: string
}

export interface DataDimension {
  code: string
  label: string
  enabled: boolean
  valueSource: DimValueSource
  dictType?: string
  bindings: DimBinding[]
  /** 内建维度（部门/本人不在此页；若后端标记则锁删除） */
  builtin?: boolean
}

/** OPTION 源选项管理行（GET /{code}/option-items）：id=行 PK（PUT/DELETE 用），value=授权值（不可改） */
export interface DimOptionRow {
  id: number
  value: number
  label: string
  sort?: number
  enabled?: boolean
}

export interface BindableEntity {
  entity: string
  label: string
  columns: { column: string; label: string }[]
}

export interface DpResult<T> {
  data: T
  demo: boolean
}

export const VALUE_SOURCE_META: Record<DimValueSource, { label: string; className: string; desc: string }> = {
  OPTION: { label: "自定义选项", className: "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400", desc: "本页维护选项（名称/排序/启停）" },
  DICT: { label: "数据字典", className: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400", desc: "取所选字典类型的字典项作可选值（字典管理页维护）" },
  DEPT: { label: "组织部门", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", desc: "取组织部门树作可选值（部门管理页维护）" },
  PROVIDER: { label: "代码内置", className: "border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-400", desc: "由内置 Provider（代码注册 bean）提供取值，不在此维护" },
}

/** 新建可选来源（PROVIDER 仅存量代码注册，UI 不可新建） */
export const CREATABLE_SOURCES: DimValueSource[] = ["OPTION", "DICT", "DEPT"]

const BASE = "/api/system/data-dimensions"

/* ============================ 归一 ============================ */

export function normList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === "object" && Array.isArray((raw as { list?: unknown }).list)) return (raw as { list: T[] }).list
  return []
}

function normDim(raw: unknown): DataDimension | null {
  const o = raw as Partial<DataDimension> | null
  if (!o || typeof o.code !== "string") return null
  return {
    code: o.code,
    label: typeof o.label === "string" ? o.label : o.code,
    enabled: o.enabled !== false,
    valueSource: o.valueSource === "DICT" || o.valueSource === "DEPT" || o.valueSource === "PROVIDER" ? o.valueSource : "OPTION",
    dictType: typeof o.dictType === "string" ? o.dictType : undefined,
    bindings: Array.isArray(o.bindings) ? o.bindings.filter((b): b is DimBinding => !!b && typeof b.entity === "string") : [],
    builtin: o.builtin === true,
  }
}

function normOptionRow(raw: unknown): DimOptionRow | null {
  const o = raw as { id?: unknown; value?: unknown; label?: unknown; sort?: unknown; enabled?: unknown } | null
  if (!o || typeof o.id !== "number") return null
  return {
    id: o.id,
    value: typeof o.value === "number" ? o.value : o.id,
    label: typeof o.label === "string" ? o.label : String(o.value ?? o.id),
    sort: typeof o.sort === "number" ? o.sort : undefined,
    enabled: o.enabled !== false,
  }
}

/* ============================ 演示态 ============================ */

interface MockState {
  dims: DataDimension[]
  options: Record<string, DimOptionRow[]>
  entities: BindableEntity[]
  seq: number
}

function mkMock(): MockState {
  return {
    dims: [
      { code: "costCenter", label: "成本中心", enabled: true, valueSource: "PROVIDER", bindings: [{ entity: "oa_approval", column: "cost_center_id" }] },
      { code: "channel", label: "渠道", enabled: true, valueSource: "OPTION", bindings: [] },
      { code: "bizLine", label: "业务线", enabled: true, valueSource: "DICT", dictType: "biz_line", bindings: [] },
      { code: "orgArea", label: "所属组织", enabled: false, valueSource: "DEPT", bindings: [{ entity: "oa_approval", column: "dept_id" }] },
    ],
    options: {
      channel: [
        { id: 11, value: 1, label: "线上直营", sort: 1, enabled: true },
        { id: 12, value: 2, label: "渠道分销", sort: 2, enabled: true },
        { id: 13, value: 3, label: "历史渠道", sort: 3, enabled: false },
      ],
    },
    entities: [
      { entity: "oa_approval", label: "审批单", columns: [{ column: "cost_center_id", label: "成本中心" }, { column: "project_id", label: "项目" }, { column: "dept_id", label: "部门" }] },
      { entity: "oa_bizdoc", label: "业务单据", columns: [{ column: "cost_center_id", label: "成本中心" }] },
    ],
    seq: 100,
  }
}

let MOCK: MockState | null = null
function mock(): MockState {
  if (!MOCK) MOCK = mkMock()
  return MOCK
}

/** 测试用：重置演示数据 */
export function resetDimensionMock(): void {
  MOCK = null
}

async function withMock<T>(fn: () => Promise<T>, m: () => T): Promise<DpResult<T>> {
  if (useAuthStore.getState().offline) return { data: m(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    if (err instanceof NetworkError) return { data: m(), demo: true }
    if (err instanceof ApiError && err.code === 404) return { data: m(), demo: true }
    throw err
  }
}

/* ============================ 维度 CRUD ============================ */

export function fetchDimensions(): Promise<DpResult<DataDimension[]>> {
  return withMock(
    // 管理口径 ?all=1：含停用行（缺省仅启用是授权 UI 兼容口径）
    () => api<unknown>(`${BASE}?all=1`).then((r) => normList<unknown>(r).map(normDim).filter((d): d is DataDimension => !!d)),
    () => mock().dims.map((d) => ({ ...d })),
  )
}

export function createDimension(input: { code: string; label: string; valueSource: DimValueSource; dictType?: string; bindings: DimBinding[] }): Promise<DpResult<boolean>> {
  return withMock(
    () => api<void>(BASE, { method: "POST", body: JSON.stringify(input) }).then(() => true),
    () => {
      const m = mock()
      if (m.dims.some((d) => d.code === input.code)) throw new ApiError(400, `维度编码「${input.code}」已存在`)
      m.dims.push({ ...input, enabled: true })
      if (input.valueSource === "OPTION") m.options[input.code] = []
      return true
    },
  )
}

export function updateDimension(code: string, input: { label: string; enabled: boolean; dictType?: string; bindings: DimBinding[] }): Promise<DpResult<boolean>> {
  return withMock(
    () => api<void>(`${BASE}/${encodeURIComponent(code)}`, { method: "PUT", body: JSON.stringify(input) }).then(() => true),
    () => {
      const d = mock().dims.find((x) => x.code === code)
      if (d) Object.assign(d, input)
      return true
    },
  )
}

/** 删除（软删）：被授权引用 → 409 照抛（UI 展示引导文案） */
export function deleteDimension(code: string): Promise<DpResult<boolean>> {
  return withMock(
    () => api<void>(`${BASE}/${encodeURIComponent(code)}`, { method: "DELETE" }).then(() => true),
    () => {
      const m = mock()
      // 演示 409：costCenter 视为已被授权引用
      if (code === "costCenter") throw new ApiError(409, "该维度已被角色/用户授权引用，请先解除相关授权")
      m.dims = m.dims.filter((d) => d.code !== code)
      return true
    },
  )
}

/* ============================ 选项管理（仅 OPTION 源） ============================ */

/** 管理表格读【manage】：GET /{code}/option-items（含禁用行，id=行PK 精确回显） */
export function fetchDimOptionItems(code: string): Promise<DpResult<DimOptionRow[]>> {
  return withMock(
    () => api<unknown>(`${BASE}/${encodeURIComponent(code)}/option-items`).then((r) => normList<unknown>(r).map(normOptionRow).filter((o): o is DimOptionRow => !!o)),
    () => (mock().options[code] ?? []).map((o) => ({ ...o })),
  )
}

/** 新增选项：value 缺省自增；重值 → 409 照抛 */
export function createDimOption(code: string, input: { value?: number; label: string; sort?: number; enabled?: boolean }): Promise<DpResult<boolean>> {
  return withMock(
    () => api<void>(`${BASE}/${encodeURIComponent(code)}/options`, { method: "POST", body: JSON.stringify(input) }).then(() => true),
    () => {
      const m = mock()
      const list = (m.options[code] ??= [])
      const value = input.value ?? ++m.seq
      if (list.some((x) => x.value === value)) throw new ApiError(409, `选项值 ${value} 已存在`)
      list.push({ id: ++m.seq, value, label: input.label, sort: input.sort ?? list.length + 1, enabled: input.enabled !== false })
      return true
    },
  )
}

/** 改选项：路径参数=行 PK；value 不可改（改值=删旧建新） */
export function updateDimOption(code: string, id: number, input: { label?: string; sort?: number; enabled?: boolean }): Promise<DpResult<boolean>> {
  return withMock(
    () => api<void>(`${BASE}/${encodeURIComponent(code)}/options/${id}`, { method: "PUT", body: JSON.stringify(input) }).then(() => true),
    () => {
      const o = (mock().options[code] ?? []).find((x) => x.id === id)
      if (o) Object.assign(o, input)
      return true
    },
  )
}

export function deleteDimOption(code: string, id: number): Promise<DpResult<boolean>> {
  return withMock(
    () => api<void>(`${BASE}/${encodeURIComponent(code)}/options/${id}`, { method: "DELETE" }).then(() => true),
    () => {
      const m = mock()
      m.options[code] = (m.options[code] ?? []).filter((x) => x.id !== id)
      return true
    },
  )
}

/* ============================ 可绑实体目录 / 字典类型 ============================ */

export function fetchBindableEntities(): Promise<DpResult<BindableEntity[]>> {
  return withMock(
    () => api<unknown>(`${BASE}/bindable-entities`).then((r) => normList<BindableEntity>(r)),
    () => mock().entities.map((e) => ({ ...e })),
  )
}

export function fetchDictTypes(): Promise<DpResult<{ type: string; name: string }[]>> {
  return withMock(
    () =>
      api<{ list?: { type?: string; code?: string; name?: string }[] }>("/api/infra/dict/types?pageNum=1&pageSize=100").then((r) =>
        (Array.isArray(r?.list) ? r.list : []).map((t) => ({ type: String(t.type ?? t.code ?? ""), name: String(t.name ?? t.type ?? "") })).filter((t) => t.type),
      ),
    () => [
      { type: "biz_line", name: "业务线" },
      { type: "region", name: "区域" },
    ],
  )
}
