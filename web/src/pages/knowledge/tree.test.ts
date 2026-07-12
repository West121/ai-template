import { describe, it, expect } from "vitest"
import { buildDocTree, descendantIds, findNode, firstDoc, isDescendant } from "./tree"
import type { KbDoc } from "./types"

const mk = (id: number, parentId: number | null, sort: number, type: "FOLDER" | "DOC" = "DOC"): KbDoc => ({
  id,
  spaceId: 1,
  parentId,
  type,
  title: `n${id}`,
  sort,
  status: "PUBLISHED",
  version: 1,
})

describe("buildDocTree", () => {
  const flat = [mk(1, null, 2, "FOLDER"), mk(2, 1, 1), mk(3, 1, 2), mk(4, null, 1, "FOLDER"), mk(5, 999, 1)]

  it("扁平 → 嵌套；根按 sort 升序（同 sort 按 id）；未知/null parent 归根", () => {
    const tree = buildDocTree(flat)
    // 根：4(sort1)、5(parent999 不存在→根, sort1)、1(sort2) → [4,5,1]
    expect(tree.map((n) => n.id)).toEqual([4, 5, 1])
    const n1 = tree.find((n) => n.id === 1)!
    expect(n1.children.map((c) => c.id)).toEqual([2, 3]) // 子层按 sort
  })

  it("非数组入参 → 空树（防白屏）", () => {
    expect(buildDocTree(null)).toEqual([])
    expect(buildDocTree(undefined)).toEqual([])
  })

  it("findNode / descendantIds / firstDoc", () => {
    const tree = buildDocTree(flat)
    expect(findNode(tree, 2)?.title).toBe("n2")
    expect(findNode(tree, 404)).toBeUndefined()
    expect(descendantIds(findNode(tree, 1)!).sort()).toEqual([2, 3])
    // 树序首个 DOC：4(空目录)→5(DOC) → 5
    expect(firstDoc(tree)?.id).toBe(5)
  })

  it("isDescendant：禁止把目录拖进自身子树的判据", () => {
    expect(isDescendant(flat, 1, 2)).toBe(true) // 2 是 1 的后代
    expect(isDescendant(flat, 1, 4)).toBe(false)
  })
})
