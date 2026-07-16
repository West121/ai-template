/**
 * 开发者工作台（Dev Studio）· API 层（磐石统一门面，契约钉死；批W1）。mock 先行：
 * offline/404/NetworkError → 演示资产 + demo；真实业务错照抛——409=版本冲突（DevConflictError，提示刷新对比）、
 * 400=校验失败（如流程转换干跑不过，展示错误明细）。列表/内容归一（防白屏）。
 *
 * ── 契约（字段名钉死）────────────────────────────────────────────────────────
 *  GET  /api/dev-studio/assets → [{type:"ORCH"|"PROCESS"|"FORM"|"BIZDOC_TPL", code, name, status, version, updatedAt}]
 *  GET  /api/dev-studio/assets/{type}/{code} → {content(JSON 串), version, meta{designerType?,formType?,name,status,...}}
 *  PUT  .../{type}/{code} {content, baseVersion?, publish?} → {version, meta?{latestPointerChanged?}}
 *  GET  .../versions → [{versionNo, actor:"USER"|"AI", actorName?, summary?, createdAt}]
 *  POST .../rollback {versionNo} → {version}（PROCESS/BIZDOC_TPL 后端可能回 unsupported → 如实展示）
 *  权限：dev:studio:view（页）/ dev:studio:edit（写）；离线 permissions=null 放行
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

export type DevAssetType = "ORCH" | "PROCESS" | "FORM" | "BIZDOC_TPL"
export type DevAssetStatus = "DRAFT" | "PUBLISHED" | "ENABLED"

export interface DevAsset {
  type: DevAssetType
  code: string
  name: string
  status: DevAssetStatus
  version: number
  updatedAt?: string
}

export interface DevAssetDetail {
  /** 资产 JSON 串（后端保证为字符串；对象/垃圾在归一层容错） */
  content: string
  version: number
  meta: {
    name?: string
    status?: DevAssetStatus
    /** PROCESS：GRAPH 可 raw 编辑；DINGTALK/BPMN 只读+跳设计器 */
    designerType?: string
    formType?: string
    [k: string]: unknown
  }
}

export interface DevAssetVersion {
  versionNo: number
  actor: "USER" | "AI"
  actorName?: string
  summary?: string
  createdAt?: string
  /** 后端若随列表带内容则直用；否则查看/对比时单取 */
  content?: string
}

export interface SaveResult {
  version: number
  meta?: { latestPointerChanged?: boolean; [k: string]: unknown }
}

export interface DpResult<T> {
  data: T
  demo: boolean
}

/** 409 版本冲突（别人已改）——UI 提示「已被他人修改，请刷新对比」 */
export class DevConflictError extends Error {
  constructor(message = "资产已被他人修改，请刷新后对比") {
    super(message)
    this.name = "DevConflictError"
  }
}

const BASE = "/api/dev-studio/assets"

/** 类型 → 中文组名/徽标 */
export const ASSET_TYPE_META: Record<DevAssetType, { label: string; designerPath: (code: string) => string }> = {
  ORCH: { label: "自动化编排", designerPath: (code) => `/automation/${code}/design` },
  PROCESS: { label: "流程定义", designerPath: (code) => `/workflow/defs/${code}/design` },
  FORM: { label: "在线表单", designerPath: () => "/workflow/form-defs" },
  BIZDOC_TPL: { label: "打印模板", designerPath: () => "/bizdoc/tpls" },
}

export const STATUS_META: Record<DevAssetStatus, { label: string; className: string }> = {
  DRAFT: { label: "草稿", className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  PUBLISHED: { label: "已发布", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  ENABLED: { label: "已启用", className: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400" },
}

/* ============================ 归一（防白屏） ============================ */

function normAssets(raw: unknown): DevAsset[] {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { list?: unknown }).list) ? (raw as { list: unknown[] }).list : []
  return arr.filter((a): a is DevAsset => !!a && typeof (a as DevAsset).code === "string" && typeof (a as DevAsset).type === "string")
}

function normDetail(raw: unknown): DevAssetDetail {
  const o = (raw ?? {}) as Partial<DevAssetDetail> & { content?: unknown }
  const content = typeof o.content === "string" ? o.content : o.content == null ? "" : JSON.stringify(o.content)
  return { content, version: typeof o.version === "number" ? o.version : 0, meta: o.meta && typeof o.meta === "object" ? o.meta : {} }
}

function normVersions(raw: unknown): DevAssetVersion[] {
  const arr = Array.isArray(raw) ? raw : []
  return arr.filter((v): v is DevAssetVersion => !!v && typeof (v as DevAssetVersion).versionNo === "number")
}

/* ============================ 演示态（后端未连接/门面未上线） ============================ */

interface MockEntry {
  asset: DevAsset
  detail: DevAssetDetail
  versions: DevAssetVersion[]
}

function mkMock(): Record<string, MockEntry> {
  const j = (o: unknown) => JSON.stringify(o, null, 2)
  const e = (asset: DevAsset, content: unknown, meta: DevAssetDetail["meta"], versions: DevAssetVersion[]): [string, MockEntry] => [
    `${asset.type}:${asset.code}`,
    { asset, detail: { content: j(content), version: asset.version, meta: { name: asset.name, status: asset.status, ...meta } }, versions },
  ]
  return Object.fromEntries([
    e(
      { type: "ORCH", code: "sync_users", name: "同步用户", status: "ENABLED", version: 4, updatedAt: "2026-07-15T10:00:00" },
      { schemaVersion: 1, key: "sync_users", name: "同步用户", nodes: [{ id: "t1", type: "trigger", name: "CRON", config: { triggerType: "CRON", cron: "0 0 2 * * ?" } }, { id: "end1", type: "end", name: "结束", config: {} }], edges: [{ id: "e1", source: "t1", target: "end1" }] },
      {},
      [
        { versionNo: 4, actor: "USER", actorName: "admin", summary: "改 CRON 到凌晨 2 点", createdAt: "2026-07-15T10:00:00" },
        { versionNo: 3, actor: "AI", actorName: "AI·丹青", summary: "加失败重试", createdAt: "2026-07-14T09:00:00" },
        { versionNo: 2, actor: "USER", actorName: "admin", createdAt: "2026-07-10T09:00:00" },
      ],
    ),
    e(
      { type: "ORCH", code: "notify_daily", name: "每日晨报", status: "DRAFT", version: 0, updatedAt: "2026-07-16T08:00:00" },
      { schemaVersion: 1, key: "notify_daily", name: "每日晨报", nodes: [], edges: [] },
      {},
      [],
    ),
    e(
      { type: "PROCESS", code: "leave_approval", name: "请假审批", status: "PUBLISHED", version: 2, updatedAt: "2026-07-15T15:00:00" },
      { schemaVersion: 1, key: "leave_approval", name: "请假审批", nodes: [{ id: "start", type: "startEvent", name: "开始" }, { id: "mgr", type: "userTask", name: "部门经理审批" }, { id: "end", type: "endEvent", name: "结束" }], edges: [{ id: "e1", source: "start", target: "mgr" }, { id: "e2", source: "mgr", target: "end" }] },
      { designerType: "GRAPH" },
      [{ versionNo: 2, actor: "USER", actorName: "admin", summary: "转 GRAPH", createdAt: "2026-07-15T15:00:00" }],
    ),
    e(
      { type: "PROCESS", code: "gongwen_fawen", name: "公文发文", status: "PUBLISHED", version: 1, updatedAt: "2026-07-01T09:00:00" },
      { nodes: [{ id: "draft", type: "approval", name: "拟稿" }] },
      { designerType: "DINGTALK" },
      [],
    ),
    e(
      { type: "FORM", code: "leave", name: "请假单", status: "PUBLISHED", version: 3, updatedAt: "2026-07-12T09:00:00" },
      { widgets: [{ type: "select", key: "leaveType", label: "请假类型", required: true }, { type: "number", key: "days", label: "请假天数", required: true }] },
      { formType: "ONLINE" },
      [
        { versionNo: 3, actor: "USER", actorName: "admin", summary: "加事由必填", createdAt: "2026-07-12T09:00:00" },
        { versionNo: 2, actor: "USER", actorName: "admin", createdAt: "2026-07-01T09:00:00" },
      ],
    ),
    e(
      { type: "BIZDOC_TPL", code: "gw_send_tpl", name: "公文发文模板", status: "DRAFT", version: 0, updatedAt: "2026-07-16T09:00:00" },
      { schemaVersion: 2, page: { size: "A4" }, blocks: [{ id: "b1", type: "title", text: "发文稿纸" }] },
      {},
      [],
    ),
  ])
}

let MOCK: Record<string, MockEntry> | null = null
function mockStore(): Record<string, MockEntry> {
  if (!MOCK) MOCK = mkMock()
  return MOCK
}

/** 测试用：重置演示数据（模块级可变，跨用例隔离） */
export function resetDevStudioMock(): void {
  MOCK = null
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<DpResult<T>> {
  if (useAuthStore.getState().offline) return { data: mock(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    // 门面未上线(404)/网络不通 → 演示降级；真实业务错（409 冲突/400 校验/403 无权）照抛
    if (err instanceof NetworkError) return { data: mock(), demo: true }
    if (err instanceof ApiError && err.code === 404) return { data: mock(), demo: true }
    throw err
  }
}

/* ============================ API ============================ */

export function fetchDevAssets(): Promise<DpResult<DevAsset[]>> {
  return withMock(
    () => api<unknown>(BASE).then(normAssets),
    () => Object.values(mockStore()).map((m) => m.asset),
  )
}

export function fetchDevAsset(type: DevAssetType, code: string): Promise<DpResult<DevAssetDetail>> {
  return withMock(
    () => api<unknown>(`${BASE}/${type}/${encodeURIComponent(code)}`).then(normDetail),
    () => {
      const m = mockStore()[`${type}:${code}`]
      return m ? { ...m.detail } : { content: "", version: 0, meta: {} }
    },
  )
}

/** 保存草稿/发布：409 → DevConflictError；400（校验失败/干跑不过）→ ApiError 照抛，UI 展示明细 */
export async function saveDevAsset(
  type: DevAssetType,
  code: string,
  body: { content: string; baseVersion?: number; publish?: boolean },
): Promise<DpResult<SaveResult>> {
  try {
    return await withMock(
      () => api<SaveResult>(`${BASE}/${type}/${encodeURIComponent(code)}`, { method: "PUT", body: JSON.stringify(body) }),
      () => {
        const m = mockStore()[`${type}:${code}`]
        const nextVersion = (m?.detail.version ?? 0) + 1
        if (m) {
          m.detail.content = body.content
          m.detail.version = nextVersion
          m.asset.version = nextVersion
          m.asset.status = body.publish ? "PUBLISHED" : "DRAFT"
          m.detail.meta.status = m.asset.status
          m.versions.unshift({ versionNo: nextVersion, actor: "USER", actorName: "（演示）", summary: body.publish ? "发布" : "保存草稿", createdAt: new Date().toISOString().slice(0, 19), content: body.content })
        }
        return { version: nextVersion, meta: type === "FORM" && !body.publish ? { latestPointerChanged: true } : undefined }
      },
    )
  } catch (err) {
    if (err instanceof ApiError && err.code === 409) throw new DevConflictError(err.message)
    throw err
  }
}

export function fetchDevVersions(type: DevAssetType, code: string): Promise<DpResult<DevAssetVersion[]>> {
  return withMock(
    () => api<unknown>(`${BASE}/${type}/${encodeURIComponent(code)}/versions`).then(normVersions),
    () => [...(mockStore()[`${type}:${code}`]?.versions ?? [])],
  )
}

/** 某版本内容（查看/对比用）：列表项自带 content 则不必调；端点对账见汇报 */
export function fetchDevVersionContent(type: DevAssetType, code: string, versionNo: number): Promise<DpResult<string>> {
  return withMock(
    () =>
      api<unknown>(`${BASE}/${type}/${encodeURIComponent(code)}/versions/${versionNo}`).then((r) => {
        const o = (r ?? {}) as { content?: unknown }
        return typeof o.content === "string" ? o.content : o.content == null ? "" : JSON.stringify(o.content)
      }),
    () => {
      const m = mockStore()[`${type}:${code}`]
      return m?.versions.find((v) => v.versionNo === versionNo)?.content ?? m?.detail.content ?? ""
    },
  )
}

export function rollbackDevAsset(type: DevAssetType, code: string, versionNo: number): Promise<DpResult<{ version: number }>> {
  return withMock(
    () => api<{ version: number }>(`${BASE}/${type}/${encodeURIComponent(code)}/rollback`, { method: "POST", body: JSON.stringify({ versionNo }) }),
    () => {
      const m = mockStore()[`${type}:${code}`]
      const nextVersion = (m?.detail.version ?? 0) + 1
      if (m) {
        const snap = m.versions.find((v) => v.versionNo === versionNo)
        if (snap?.content) m.detail.content = snap.content
        m.detail.version = nextVersion
        m.asset.version = nextVersion
        m.versions.unshift({ versionNo: nextVersion, actor: "USER", actorName: "（演示）", summary: `回滚到 v${versionNo}`, createdAt: new Date().toISOString().slice(0, 19), content: m.detail.content })
      }
      return { version: nextVersion }
    },
  )
}
