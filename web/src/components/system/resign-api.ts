/**
 * 离职交接（DP2）· API 层（后端 DP2a 已上线，契约钉死）。mock 先行：offline/404/NetworkError → 演示态 + demo；
 * 真实业务错（400 部门负责人阻断 / 403 无权）**照抛**（向导据此提示/停步）。响应归一（items 非数组→[]）。
 *
 * ── 契约（字段名照用）──────────────────────────────────────────────────────────
 *  POST /api/system/users/{id}/resign  {successorId?, reason?, resignDate?} → {handoverId}
 *       部门负责人未指定继任 → **400**（消息含"请先指定继任者"）。
 *  GET  /api/system/handovers/{id}     → Handover（含 items[]）。
 *  PUT  /api/system/handovers/{id}/items/{itemId}  {successorId?, status?:"SKIPPED"|"PENDING"}（DONE 项不可改）。
 *  POST /api/system/handovers/{id}/execute  → {doneIds:number[], failed:[{itemId,reason}]}（item 级可重试、幂等）。
 *  权限：system:user:edit。itemType：WF_TASK→待办转办、DEPT_LEADER→部门负责人变更、KB_SPACE_OWNER→知识空间归属、未知→原值兜底。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

export type HandoverItemStatus = "PENDING" | "DONE" | "SKIPPED"
export type HandoverStatus = "DRAFT" | "RUNNING" | "DONE"

export interface HandoverItem {
  id: number
  itemType: string
  refType?: string
  refId?: number
  oldValue?: string
  newValue?: string
  status: HandoverItemStatus
  successorId?: number
  note?: string
}
export interface Handover {
  id: number
  fromUserId: number
  fromUserName: string
  toUserId?: number
  toUserName?: string
  type?: string
  reason?: string
  status: HandoverStatus
  createdAt?: string
  completedAt?: string
  items: HandoverItem[]
}
export interface ResignInput {
  successorId?: number
  reason?: string
  resignDate?: string
}
export interface ExecuteResult {
  doneIds: number[]
  failed: { itemId: number; reason: string }[]
}
export interface DpResult<T> {
  data: T
  demo: boolean
}

const BASE = "/api/system"

/** itemType 人话标签（未知 → 原值兜底，不炸） */
const ITEM_TYPE_LABEL: Record<string, string> = { WF_TASK: "待办转办", DEPT_LEADER: "部门负责人变更", KB_SPACE_OWNER: "知识空间归属" }
export function itemTypeLabel(t: string): string {
  return ITEM_TYPE_LABEL[t] ?? t
}
export const ITEM_STATUS_META: Record<HandoverItemStatus, { label: string; className: string }> = {
  PENDING: { label: "待处理", className: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
  DONE: { label: "已完成", className: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  SKIPPED: { label: "已跳过", className: "border-muted-foreground/30 text-muted-foreground" },
}

/* ---------------- 演示态（后端未连接） ---------------- */
let mockSeq = 9000
const MOCK_STORE: Record<number, Handover> = {}
function demoHandover(id: number, successorId?: number): Handover {
  return {
    id,
    fromUserId: 0,
    fromUserName: "（演示）离职员工",
    toUserId: successorId,
    toUserName: successorId ? `#${successorId}` : undefined,
    type: "RESIGN",
    status: "DRAFT",
    createdAt: new Date().toISOString().slice(0, 19),
    items: [
      { id: id * 10 + 1, itemType: "WF_TASK", refType: "task", refId: 1001, oldValue: "离职员工", newValue: successorId ? `#${successorId}` : "（待指定）", status: "PENDING", successorId },
      { id: id * 10 + 2, itemType: "DEPT_LEADER", refType: "dept", refId: 10, oldValue: "离职员工", newValue: successorId ? `#${successorId}` : "（待指定）", status: "PENDING", successorId },
      { id: id * 10 + 3, itemType: "CUSTOM_ASSET", refType: "asset", refId: 55, oldValue: "工牌/设备", newValue: "行政回收", status: "PENDING" },
    ],
  }
}

function normItems(raw: unknown): HandoverItem[] {
  return Array.isArray(raw) ? (raw as HandoverItem[]) : []
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<DpResult<T>> {
  if (useAuthStore.getState().offline) return { data: mock(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    // 端点未实现(404) / 网络不通 → 演示降级；真实业务错（400 阻断 / 403 无权）照抛
    if (err instanceof NetworkError) return { data: mock(), demo: true }
    if (err instanceof ApiError && err.code === 404) return { data: mock(), demo: true }
    throw err
  }
}

export function resignUser(userId: number, input: ResignInput): Promise<DpResult<{ handoverId: number }>> {
  return withMock(
    () => api<{ handoverId: number }>(`${BASE}/users/${userId}/resign`, { method: "POST", body: JSON.stringify(input) }),
    () => {
      const hid = ++mockSeq
      MOCK_STORE[hid] = demoHandover(hid, input.successorId)
      return { handoverId: hid }
    },
  )
}

export function fetchHandover(handoverId: number): Promise<DpResult<Handover>> {
  return withMock(
    () => api<Handover>(`${BASE}/handovers/${handoverId}`).then((h) => ({ ...h, items: normItems(h?.items) })),
    () => MOCK_STORE[handoverId] ?? demoHandover(handoverId),
  )
}

export function updateHandoverItem(handoverId: number, itemId: number, patch: { successorId?: number; status?: "SKIPPED" | "PENDING" }): Promise<DpResult<boolean>> {
  return withMock(
    () => api<void>(`${BASE}/handovers/${handoverId}/items/${itemId}`, { method: "PUT", body: JSON.stringify(patch) }).then(() => true),
    () => {
      const h = MOCK_STORE[handoverId]
      const it = h?.items.find((x) => x.id === itemId)
      if (it && it.status !== "DONE") {
        if (patch.status) it.status = patch.status
        if (patch.successorId !== undefined) {
          it.successorId = patch.successorId
          it.newValue = `#${patch.successorId}`
        }
      }
      return true
    },
  )
}

export function executeHandover(handoverId: number): Promise<DpResult<ExecuteResult>> {
  return withMock(
    () => api<ExecuteResult>(`${BASE}/handovers/${handoverId}/execute`, { method: "POST" }),
    () => {
      const h = MOCK_STORE[handoverId]
      const doneIds: number[] = []
      if (h) {
        for (const it of h.items) {
          if (it.status === "PENDING") {
            it.status = "DONE"
            doneIds.push(it.id)
          }
        }
        if (h.items.every((it) => it.status !== "PENDING")) {
          h.status = "DONE"
          h.completedAt = new Date().toISOString().slice(0, 19)
        }
      }
      return { doneIds, failed: [] }
    },
  )
}
