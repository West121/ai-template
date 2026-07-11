/**
 * §10 单据私有 schema → 字段派生纯函数用例。
 */
import { describe, expect, it } from "vitest"
import type { FormWidget } from "@/types/workflow"
import { deriveSchemaFields, fieldsForDef, schemaKeyIssues } from "./fields"

const SCHEMA: FormWidget[] = [
  { id: "f1", type: "input", label: "车牌号", key: "plate" },
  { id: "f2", type: "divider", label: "分割线" },
  { id: "f3", type: "note", label: "说明", content: "填写提示" },
  {
    id: "g1",
    type: "grid",
    label: "两列",
    children: [
      { id: "f4", type: "number", label: "金额", key: "amount" },
      { id: "f5", type: "date", label: "日期" }, // 无 key → 回退 id
    ],
  } as FormWidget,
  { id: "s1", type: "subform", label: "明细", key: "items" } as FormWidget,
]

describe("deriveSchemaFields（INLINE 本地派生）", () => {
  it("跳过布局件、容器透明下钻、key 缺省回退 id、subform 本身不入清单", () => {
    const fields = deriveSchemaFields(SCHEMA)
    expect(fields).toEqual([
      { key: "plate", label: "车牌号" },
      { key: "amount", label: "金额" },
      { key: "f5", label: "日期" },
    ])
  })

  it("空/非法输入回空数组", () => {
    expect(deriveSchemaFields([])).toEqual([])
    expect(deriveSchemaFields(null)).toEqual([])
    expect(deriveSchemaFields(undefined)).toEqual([])
  })
})

describe("schemaKeyIssues（发布校验：非空 + key 唯一）", () => {
  it("合法 schema 通过", () => {
    expect(schemaKeyIssues(SCHEMA)).toEqual([])
  })

  it("空 schema 拦截", () => {
    expect(schemaKeyIssues([]).length).toBe(1)
    expect(schemaKeyIssues([])[0]).toContain("表单为空")
  })

  it("重复 key 报出具体字段标识", () => {
    const dup: FormWidget[] = [
      { id: "a", type: "input", label: "甲", key: "same" },
      { id: "b", type: "input", label: "乙", key: "same" },
      { id: "c", type: "input", label: "丙", key: "ok" },
    ]
    const issues = schemaKeyIssues(dup)
    expect(issues.length).toBe(1)
    expect(issues[0]).toContain("same")
  })
})

describe("fieldsForDef（统一字段源）", () => {
  it("INLINE：从 formSchema 本地派生，不发请求", async () => {
    const fields = await fieldsForDef({ formType: "INLINE", formCode: "", formSchema: SCHEMA })
    expect(fields.map((f) => f.key)).toEqual(["plate", "amount", "f5"])
  })

  it("INLINE 空 schema 回空；CODE 无 formCode 回空", async () => {
    expect(await fieldsForDef({ formType: "INLINE", formCode: "", formSchema: [] })).toEqual([])
    expect(await fieldsForDef({ formType: "CODE", formCode: "", formSchema: null })).toEqual([])
  })
})
