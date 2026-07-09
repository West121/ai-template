import { describe, expect, it } from "vitest"
import type { FieldDescriptor } from "@/lib/form-manifest"
import type { FormPerms } from "@/pages/workflow/designer/types"
import {
  groupFields,
  permToVisibleEditable,
  visibleEditableToPerm,
  writeFieldPerm,
} from "@/components/field-perms-editor"

describe("FormPerm(tri-state) ↔ 可见/可编辑", () => {
  it("permToVisibleEditable 三态映射", () => {
    expect(permToVisibleEditable("HIDDEN")).toEqual({ visible: false, editable: false })
    expect(permToVisibleEditable("READ")).toEqual({ visible: true, editable: false })
    expect(permToVisibleEditable("EDIT")).toEqual({ visible: true, editable: true })
    expect(permToVisibleEditable(undefined)).toEqual({ visible: true, editable: true })
  })

  it("visibleEditableToPerm 反向映射", () => {
    expect(visibleEditableToPerm({ visible: false, editable: false })).toBe("HIDDEN")
    expect(visibleEditableToPerm({ visible: false, editable: true })).toBe("HIDDEN")
    expect(visibleEditableToPerm({ visible: true, editable: false })).toBe("READ")
    expect(visibleEditableToPerm({ visible: true, editable: true })).toBe("EDIT")
  })

  it("round-trip：三态 → 双列 → 三态", () => {
    for (const perm of ["HIDDEN", "READ", "EDIT"] as const) {
      expect(visibleEditableToPerm(permToVisibleEditable(perm))).toBe(perm)
    }
  })
})

describe("writeFieldPerm 读写 formPerms", () => {
  it("写入不改动其他字段", () => {
    const base: FormPerms = { a: "EDIT", b: "HIDDEN" }
    const next = writeFieldPerm(base, "a", { visible: true, editable: false })
    expect(next).toEqual({ a: "READ", b: "HIDDEN" })
    // 不可变：原对象不变
    expect(base.a).toBe("EDIT")
  })

  it("隐藏字段写 HIDDEN", () => {
    const next = writeFieldPerm({}, "c", { visible: false, editable: false })
    expect(next.c).toBe("HIDDEN")
  })
})

describe("groupFields 按 group 归组", () => {
  const fields: FieldDescriptor[] = [
    { key: "a", label: "A", type: "input", group: "基础" },
    { key: "b", label: "B", type: "number", group: "明细" },
    { key: "c", label: "C", type: "input", group: "基础" },
    { key: "d", label: "D", type: "input" }, // 无 group → 默认组
  ]

  it("保持组首次出现顺序与字段顺序", () => {
    const groups = groupFields(fields)
    expect(groups.map((g) => g.name)).toEqual(["基础", "明细", "基础字段"])
    expect(groups[0].fields.map((f) => f.key)).toEqual(["a", "c"])
    expect(groups[1].fields.map((f) => f.key)).toEqual(["b"])
    expect(groups[2].fields.map((f) => f.key)).toEqual(["d"])
  })
})
