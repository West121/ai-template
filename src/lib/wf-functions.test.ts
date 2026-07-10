import { afterEach, describe, expect, it, vi } from "vitest"

// 用可控 mock 替换真实 api：无需后端即可测缓存 / 降级 / 适配逻辑。
const apiMock = vi.fn()
vi.mock("@/lib/api", () => ({
  api: (path: string) => apiMock(path),
}))

import {
  CUSTOM_CATEGORY,
  customFnDocs,
  getExpressionFunctions,
  pickCustomFunctions,
  referencesFunction,
  resetExpressionFunctionsCache,
  type FnMeta,
} from "@/lib/wf-functions"

const CUSTOM: FnMeta[] = [
  { name: "workDays", signature: "workDays(start, end)", category: CUSTOM_CATEGORY, description: "工作日天数" },
  { name: "deptLeader", signature: "deptLeader(level)", category: CUSTOM_CATEGORY, description: "部门主管" },
]

const SAMPLE: FnMeta[] = [
  { name: "ROLE", signature: 'ROLE("角色名")', category: "ASSIGNEE", description: "角色成员" },
  { name: "IF", signature: "IF(cond, a, b)", category: "LOGIC", description: "条件取值" },
  ...CUSTOM,
]

afterEach(() => {
  resetExpressionFunctionsCache()
  apiMock.mockReset()
})

describe("getExpressionFunctions · 进程内缓存", () => {
  it("会话内只请求一次，重复调用复用同一 Promise", async () => {
    apiMock.mockResolvedValue(SAMPLE)
    const p1 = getExpressionFunctions()
    const p2 = getExpressionFunctions()
    expect(p1).toBe(p2)
    await expect(p1).resolves.toEqual(SAMPLE)
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith("/api/wf/expression/functions")
  })
})

describe("getExpressionFunctions · 优雅降级", () => {
  it("请求失败（离线/权限/后端未启动）降级为空数组，永不 reject", async () => {
    apiMock.mockRejectedValue(new Error("无法连接后端服务"))
    await expect(getExpressionFunctions()).resolves.toEqual([])
  })

  it("降级结果同样被缓存，不会反复重试", async () => {
    apiMock.mockRejectedValue(new Error("boom"))
    await getExpressionFunctions()
    await getExpressionFunctions()
    expect(apiMock).toHaveBeenCalledTimes(1)
  })
})

describe("pickCustomFunctions", () => {
  it("只保留 CUSTOM 分类，滤除内置项", () => {
    expect(pickCustomFunctions(SAMPLE)).toEqual(CUSTOM)
  })

  it("按 name 去重（保留首次出现）", () => {
    const dup: FnMeta[] = [...CUSTOM, { ...CUSTOM[0], description: "重复项" }]
    const out = pickCustomFunctions(dup)
    expect(out).toHaveLength(2)
    expect(out[0].description).toBe("工作日天数")
  })

  it("无 CUSTOM 时返回空数组", () => {
    expect(pickCustomFunctions(SAMPLE.filter((f) => f.category !== CUSTOM_CATEGORY))).toEqual([])
  })
})

describe("customFnDocs · 适配为 FnDoc", () => {
  it("insertTemplate 为 name( 模板，分类可指定", () => {
    const docs = customFnDocs(CUSTOM, "扩展函数")
    expect(docs[0]).toMatchObject({
      name: "workDays",
      insertTemplate: "workDays(",
      signature: "workDays(start, end)",
      category: "扩展函数",
      description: "工作日天数",
    })
  })

  it("传 backendNote 时追加「后端函数」标注到说明", () => {
    const docs = customFnDocs(CUSTOM, "扩展函数", "后端函数，前端不预览")
    expect(docs[0].description).toBe("工作日天数（后端函数，前端不预览）")
  })
})

describe("referencesFunction · CUSTOM 容错检测", () => {
  const names = new Set(["workDays", "deptLeader"])

  it("命中形如 NAME( 的调用", () => {
    expect(referencesFunction("workDays(a, b) > 3", names)).toBe(true)
    expect(referencesFunction("IF(deptLeader(1), a, b)", names)).toBe(true)
  })

  it("无命中或空名单返回 false", () => {
    expect(referencesFunction("SUM(items.amount) > 1000", names)).toBe(false)
    expect(referencesFunction("workDays(a)", new Set())).toBe(false)
  })
})
