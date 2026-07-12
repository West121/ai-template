import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runBatch } from "./batch"
import { useAuthStore } from "@/stores/auth-store"

beforeEach(() => {
  useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
})
afterEach(() => vi.unstubAllGlobals())

describe("runBatch", () => {
  it("批量端点成功 → 直接返回 {successIds, failed}，不逐条", async () => {
    vi.stubGlobal("fetch", async () => ({ status: 200, json: async () => ({ code: 0, data: { successIds: [1, 2, 3], failed: [] } }) }) as unknown as Response)
    const single = vi.fn()
    const r = await runBatch({ ids: [1, 2, 3], batchPath: "/api/x/batch-delete", single })
    expect(r.successIds).toEqual([1, 2, 3])
    expect(r.failed).toEqual([])
    expect(single).not.toHaveBeenCalled()
  })

  it("批量端点 404（未实现）→ 逐条兜底聚合成功/失败", async () => {
    vi.stubGlobal("fetch", async () => ({ status: 404, json: async () => ({ code: 404, message: "未实现" }) }) as unknown as Response)
    const single = vi.fn(async (id: number) => {
      if (id === 2) throw new Error("被引用无法删除")
    })
    const r = await runBatch({ ids: [1, 2, 3], batchPath: "/api/x/batch-delete", single })
    expect(single).toHaveBeenCalledTimes(3)
    expect(r.successIds).toEqual([1, 3])
    expect(r.failed).toEqual([{ id: 2, reason: "被引用无法删除" }])
  })

  it("批量端点真实业务错（403）→ 照抛，不误兜底", async () => {
    vi.stubGlobal("fetch", async () => ({ status: 403, json: async () => ({ code: 403, message: "没有操作权限" }) }) as unknown as Response)
    await expect(runBatch({ ids: [1], batchPath: "/api/x/batch-delete", single: vi.fn() })).rejects.toThrow(/权限/)
  })

  it("空 ids → 空结果，不发请求", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const single = vi.fn()
    const r = await runBatch({ ids: [], batchPath: "/x", single })
    expect(r).toEqual({ successIds: [], failed: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(single).not.toHaveBeenCalled()
  })
})
