import { describe, it, expect } from "vitest"
import { buildCommentTree, buildLineDiff } from "./diff-util"
import type { KbComment } from "./types"

describe("buildLineDiff", () => {
  it("相同文本 → 全 same", () => {
    const ops = buildLineDiff("A\nB", "A\nB")
    expect(ops.every((o) => o.type === "same")).toBe(true)
    expect(ops.map((o) => o.text)).toEqual(["A", "B"])
  })

  it("新增行 → add；删除行 → del", () => {
    const add = buildLineDiff("A\nB", "A\nB\nC")
    expect(add.find((o) => o.type === "add")?.text).toBe("C")
    const del = buildLineDiff("A\nB\nC", "A\nC")
    expect(del.find((o) => o.type === "del")?.text).toBe("B")
  })

  it("改行 → del 旧 + add 新", () => {
    const ops = buildLineDiff("旧内容", "新内容")
    expect(ops.some((o) => o.type === "del" && o.text === "旧内容")).toBe(true)
    expect(ops.some((o) => o.type === "add" && o.text === "新内容")).toBe(true)
  })

  it("空入参不抛", () => {
    expect(buildLineDiff("", "")).toEqual([{ type: "same", text: "" }])
  })
})

describe("buildCommentTree", () => {
  const flat: KbComment[] = [
    { id: 2, docId: 1, parentId: 1, userId: 3, userName: "b", content: "回复", createdAt: "2026-06-21T09:40:00" },
    { id: 1, docId: 1, parentId: null, userId: 2, userName: "a", content: "根评论", createdAt: "2026-06-21T09:10:00" },
    { id: 3, docId: 1, parentId: null, userId: 1, userName: "c", content: "另一根", createdAt: "2026-06-22T16:00:00" },
  ]
  it("扁平 → 回复树，根按时间升序，回复挂父下", () => {
    const tree = buildCommentTree(flat)
    expect(tree.map((n) => n.id)).toEqual([1, 3]) // 根按 createdAt 升序
    expect(tree[0].replies.map((r) => r.id)).toEqual([2])
  })
  it("非数组 → []", () => {
    expect(buildCommentTree(null)).toEqual([])
    expect(buildCommentTree(undefined)).toEqual([])
  })
})
