/**
 * 简易行级文本 diff（LCS，纯函数可测），供版本对比。绝不抛（空入参按空文本）。
 */
import type { KbComment, KbCommentNode } from "./types"

export type DiffOpType = "same" | "add" | "del"
export interface DiffOp {
  type: DiffOpType
  text: string
}

/** 行级 diff：old→new。same=未变，del=旧有新无，add=新增。 */
export function buildLineDiff(oldText: string, newText: string): DiffOp[] {
  const a = (typeof oldText === "string" ? oldText : "").split("\n")
  const b = (typeof newText === "string" ? newText : "").split("\n")
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", text: a[i] })
      i++
    } else {
      ops.push({ type: "add", text: b[j] })
      j++
    }
  }
  while (i < n) ops.push({ type: "del", text: a[i++] })
  while (j < m) ops.push({ type: "add", text: b[j++] })
  return ops
}

/** 扁平评论 → 回复树（纯函数）。parentId 为 null / 不存在 → 根；按 createdAt 升序。防白屏：非数组→[]。 */
export function buildCommentTree(flat: KbComment[] | null | undefined): KbCommentNode[] {
  const list = Array.isArray(flat) ? flat : []
  const byId = new Map<number, KbCommentNode>()
  for (const c of list) byId.set(c.id, { ...c, replies: [] })
  const roots: KbCommentNode[] = []
  for (const node of byId.values()) {
    const parent = node.parentId != null ? byId.get(node.parentId) : undefined
    if (parent && parent.id !== node.id) parent.replies.push(node)
    else roots.push(node)
  }
  const sortNodes = (nodes: KbCommentNode[]) => {
    nodes.sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id - y.id))
    for (const nd of nodes) sortNodes(nd.replies)
  }
  sortNodes(roots)
  return roots
}
