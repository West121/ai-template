/**
 * 批量操作统一执行 + 结果汇总（系统管理各页批量删除/启停/移部门等）。
 *
 * mock 先行：优先调后端批量端点（磐石随后：POST /api/system/xxx/batch-*）；端点未实现(404)或网络不通
 * → 退回逐条单端点兜底，聚合成同一协议。真实业务错（403 无权 / 409 冲突）照抛，不吞。
 *
 * 协议（主控拍板）：`{ successIds: number[], failed: [{ id, reason }] }`；前端 toast 汇总（成功 N / 失败 M）。
 */
import { toast } from "sonner"
import { ApiError, NetworkError, api } from "@/lib/api"

export interface BatchResult {
  successIds: number[]
  failed: { id: number; reason: string }[]
}

export interface RunBatchOptions {
  ids: number[]
  /** 后端批量端点（POST） */
  batchPath: string
  /** 批量请求体，默认 `{ ids }` */
  batchBody?: (ids: number[]) => unknown
  /** 单条兜底（批量端点未实现时逐条调用现有单端点） */
  single: (id: number) => Promise<unknown>
}

/**
 * 执行批量：批量端点优先，404/网络 → 逐条兜底。返回统一 `{ successIds, failed }`。
 * 破坏性操作的二次确认由调用方（alert-dialog）负责，此处只管执行与聚合。
 */
export async function runBatch(opts: RunBatchOptions): Promise<BatchResult> {
  const { ids, batchPath, batchBody, single } = opts
  const list = Array.isArray(ids) ? ids : []
  if (list.length === 0) return { successIds: [], failed: [] }

  try {
    const res = await api<Partial<BatchResult>>(batchPath, {
      method: "POST",
      body: JSON.stringify(batchBody ? batchBody(list) : { ids: list }),
    })
    return { successIds: Array.isArray(res.successIds) ? res.successIds : list, failed: Array.isArray(res.failed) ? res.failed : [] }
  } catch (err) {
    // 真实业务错（非 404 的 ApiError，如 403/409）→ 照抛，交调用方 toast
    if (err instanceof ApiError && err.code !== 404) throw err
    if (!(err instanceof ApiError) && !(err instanceof NetworkError)) throw err
    // 404 未实现 / 网络不通 → 逐条兜底
    const settled = await Promise.allSettled(list.map((id) => single(id)))
    const successIds: number[] = []
    const failed: { id: number; reason: string }[] = []
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") successIds.push(list[i])
      else failed.push({ id: list[i], reason: r.reason instanceof Error ? r.reason.message : "操作失败" })
    })
    return { successIds, failed }
  }
}

/** 批量结果 toast 汇总（成功全绿 / 部分黄 / 全失败红） */
export function toastBatch(result: BatchResult, verb: string): void {
  const ok = result.successIds.length
  const bad = result.failed.length
  if (bad === 0) toast.success(`已${verb} ${ok} 项`)
  else if (ok === 0) toast.error(`${verb}失败：${bad} 项${result.failed[0]?.reason ? `（${result.failed[0].reason}）` : ""}`)
  else toast.warning(`${verb}完成：成功 ${ok}，失败 ${bad}`)
}
