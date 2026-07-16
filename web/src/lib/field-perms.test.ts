// @vitest-environment jsdom
/**
 * 字段权限数据层（权限中心 P3）纯逻辑单测：
 *  - 交集更严：intersectFieldPolicy（节点级 FieldPolicyMap × mine）/ intersectFormPerms（tri-state）
 *  - minePermOf 缺省全放行；filterColumnsByMine 按 accessorKey/id 隐藏列
 *  - fetchMineFieldPerms：按 feature 缓存（只打一次）、invalidate 后重拉、失败静默 {}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAuthStore } from "@/stores/auth-store"
import type { ColumnDef } from "@tanstack/react-table"
import type { FieldPolicyMap } from "@/lib/form-manifest"
import {
  fetchMineFieldPerms,
  filterColumnsByMine,
  intersectFieldPolicy,
  intersectFormPerms,
  invalidateMineFieldPerms,
  minePermOf,
  type MineFieldPerms,
} from "./field-perms"

describe("minePermOf", () => {
  it("未列出的字段=全放行", () => {
    expect(minePermOf({}, "reason")).toEqual({ visible: true, editable: true })
  })
  it("列出的字段按 mine", () => {
    const mine: MineFieldPerms = { reason: { visible: false, editable: false } }
    expect(minePermOf(mine, "reason")).toEqual({ visible: false, editable: false })
  })
})

describe("intersectFieldPolicy（交集更严）", () => {
  it("两层皆空 → undefined（保持未配置语义）", () => {
    expect(intersectFieldPolicy(undefined, {})).toBeUndefined()
  })
  it("仅节点层 → 原样透传", () => {
    const node: FieldPolicyMap = { a: { visible: true, editable: false, required: true } }
    expect(intersectFieldPolicy(node, {})).toEqual({ a: { visible: true, editable: false, required: true } })
  })
  it("仅 mine 层 → mine 限制并入（required=false）", () => {
    const mine: MineFieldPerms = { secret: { visible: false, editable: false } }
    expect(intersectFieldPolicy(undefined, mine)).toEqual({ secret: { visible: false, editable: false, required: false } })
  })
  it("两层叠加取更严：visible=都可见、editable=都可编、required 沿节点层", () => {
    const node: FieldPolicyMap = {
      a: { visible: true, editable: true, required: true }, // 节点放行、mine 只读 → 只读
      b: { visible: true, editable: false, required: false }, // 节点只读、mine 放行 → 只读
      c: { visible: false, editable: false, required: false }, // 节点隐藏、mine 放行 → 隐藏
    }
    const mine: MineFieldPerms = {
      a: { visible: true, editable: false },
      c: { visible: true, editable: true },
      d: { visible: false, editable: false }, // 节点未列 → 并入 mine 限制
    }
    expect(intersectFieldPolicy(node, mine)).toEqual({
      a: { visible: true, editable: false, required: true },
      b: { visible: true, editable: false, required: false },
      c: { visible: false, editable: false, required: false },
      d: { visible: false, editable: false, required: false },
    })
  })
})

describe("intersectFormPerms（tri-state 交集更严）", () => {
  it("mine 空 → 原样返回节点 perms（含 undefined）", () => {
    expect(intersectFormPerms(undefined, {})).toBeUndefined()
    expect(intersectFormPerms({ a: "READ" }, {})).toEqual({ a: "READ" })
  })
  it("节点缺省=EDIT，mine 受限 → HIDDEN/READ", () => {
    const mine: MineFieldPerms = {
      x: { visible: false, editable: false },
      y: { visible: true, editable: false },
    }
    expect(intersectFormPerms(undefined, mine)).toEqual({ x: "HIDDEN", y: "READ" })
  })
  it("任一层 HIDDEN → HIDDEN；任一层只读 → 至多 READ", () => {
    const mine: MineFieldPerms = {
      a: { visible: true, editable: true }, // 节点 HIDDEN 优先
      b: { visible: true, editable: true }, // 节点 READ 优先
      c: { visible: true, editable: false }, // 节点 EDIT × mine 只读 → READ
      d: { visible: false, editable: true }, // 节点 READ × mine 隐藏 → HIDDEN
    }
    expect(intersectFormPerms({ a: "HIDDEN", b: "READ", c: "EDIT", d: "READ" }, mine)).toEqual({
      a: "HIDDEN",
      b: "READ",
      c: "READ",
      d: "HIDDEN",
    })
  })
})

describe("filterColumnsByMine", () => {
  const columns: ColumnDef<{ id: number }, unknown>[] = [
    { accessorKey: "id" } as ColumnDef<{ id: number }, unknown>,
    { accessorKey: "reason" } as ColumnDef<{ id: number }, unknown>,
    { id: "actions" },
  ]
  it("mine 空 → 原数组", () => {
    expect(filterColumnsByMine(columns, {})).toBe(columns)
  })
  it("visible=false 的列（按 accessorKey/id 匹配）整列隐藏，其余保留", () => {
    const mine: MineFieldPerms = { reason: { visible: false, editable: false } }
    const out = filterColumnsByMine(columns, mine)
    expect(out.map((c) => (c as { accessorKey?: string }).accessorKey ?? c.id)).toEqual(["id", "actions"])
  })
  it("visible=true / 未列出 → 不影响", () => {
    const mine: MineFieldPerms = { id: { visible: true, editable: false } }
    expect(filterColumnsByMine(columns, mine)).toHaveLength(3)
  })
})

describe("fetchMineFieldPerms 缓存", () => {
  let calls: string[]
  let mineBody: unknown

  beforeEach(() => {
    invalidateMineFieldPerms()
    calls = []
    mineBody = { fields: { reason: { visible: false, editable: false } } }
    useAuthStore.setState({ offline: false, token: "t", permissions: null, userId: 1 })
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url))
      return { status: 200, json: async () => ({ code: 0, data: mineBody }) } as unknown as Response
    })
  })
  afterEach(() => {
    invalidateMineFieldPerms()
    vi.unstubAllGlobals()
  })

  it("同 feature 只打一次；invalidate 后重拉；不同 feature 各自缓存", async () => {
    const a1 = await fetchMineFieldPerms("ATTENDANCE_LEAVE")
    expect(a1).toEqual({ reason: { visible: false, editable: false } })
    await fetchMineFieldPerms("ATTENDANCE_LEAVE")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("/api/system/field-perms/mine?feature=ATTENDANCE_LEAVE")

    await fetchMineFieldPerms("WORKFLOW_TASKS")
    expect(calls).toHaveLength(2)

    invalidateMineFieldPerms("ATTENDANCE_LEAVE")
    await fetchMineFieldPerms("ATTENDANCE_LEAVE")
    expect(calls).toHaveLength(3)
  })

  it("拉取失败 → 静默 {}（全放行，不阻断渲染）", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("boom")
    })
    expect(await fetchMineFieldPerms("ATTENDANCE_LEAVE")).toEqual({})
  })

  it("offline → 直接 {}（不发请求）", async () => {
    useAuthStore.setState({ offline: true })
    expect(await fetchMineFieldPerms("ATTENDANCE_LEAVE")).toEqual({})
    expect(calls).toHaveLength(0)
  })
})
