/**
 * form-manifest.ts · 提交前必填校验（设计文档 2.4：required 来自清单 → fieldPolicy）。
 *
 * `missingRequiredFields` 是 CODE 表单办理动作（approve/complete）带 formData 提交前的权威门禁：
 * 只拦「可见 + 必填 + 值为空」的字段，隐藏字段不阻塞。纯函数、node 环境直测。
 */
import { describe, expect, it } from "vitest"
import {
  fieldStateOf,
  isEmptyValue,
  missingRequiredFields,
  type FieldPolicyMap,
} from "@/lib/form-manifest"

describe("isEmptyValue", () => {
  it("null/undefined/空白串/空数组视为空", () => {
    expect(isEmptyValue(null)).toBe(true)
    expect(isEmptyValue(undefined)).toBe(true)
    expect(isEmptyValue("")).toBe(true)
    expect(isEmptyValue("   ")).toBe(true)
    expect(isEmptyValue([])).toBe(true)
  })
  it("有值不视为空（含 0 / false）", () => {
    expect(isEmptyValue("3")).toBe(false)
    expect(isEmptyValue(0)).toBe(false)
    expect(isEmptyValue(false)).toBe(false)
    expect(isEmptyValue(["a"])).toBe(false)
  })
})

describe("missingRequiredFields", () => {
  const policy: FieldPolicyMap = {
    applicant: { visible: true, editable: true, required: true },
    days: { visible: true, editable: true, required: true },
    reason: { visible: true, editable: false, required: true }, // 只读但必填仍校验
    secret: { visible: false, editable: false, required: true }, // 隐藏必填 → 不阻塞
    remark: { visible: true, editable: true, required: false },
  }

  it("列出可见必填但未填的字段（顺序稳定）", () => {
    const missing = missingRequiredFields(policy, { applicant: "张三", days: "", reason: "" })
    expect(missing).toEqual(["days", "reason"])
  })

  it("隐藏的必填字段不计入", () => {
    const missing = missingRequiredFields(policy, { applicant: "张三", days: "3", reason: "事由" })
    expect(missing).toEqual([]) // secret 隐藏，不阻塞
  })

  it("全部填齐 → 空", () => {
    expect(
      missingRequiredFields(policy, { applicant: "张三", days: "3", reason: "事由", remark: "" }),
    ).toEqual([])
  })

  it("策略缺省 → 无必填约束", () => {
    expect(missingRequiredFields(undefined, {})).toEqual([])
  })
})

describe("fieldStateOf 派生（必填来自策略）", () => {
  it("required 策略 → 渲染态 required=true", () => {
    const policy: FieldPolicyMap = { days: { visible: true, editable: true, required: true } }
    expect(fieldStateOf(policy, "days").required).toBe(true)
  })
})
