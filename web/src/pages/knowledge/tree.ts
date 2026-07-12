/**
 * 知识库目录树 纯函数（可单测）：扁平 kb_doc[] → 嵌套树、查找、可见性无关。
 * 防白屏：入参非数组一律按空树处理，绝不抛。
 */
import type { KbDoc, KbTreeNode } from "./types"

/**
 * 扁平 kb_doc[] → 嵌套树。规则：
 *  - parentId 为 null / 指向不存在节点 → 视为根；
 *  - 每层按 sort 升序、其次 id 升序稳定排序；
 *  - 防环：已挂载节点不重复挂载（脏数据自愈）。
 */
export function buildDocTree(flat: KbDoc[] | null | undefined): KbTreeNode[] {
  const list = Array.isArray(flat) ? flat : []
  const byId = new Map<number, KbTreeNode>()
  for (const d of list) byId.set(d.id, { ...d, children: [] })

  const roots: KbTreeNode[] = []
  for (const node of byId.values()) {
    const parent = node.parentId != null ? byId.get(node.parentId) : undefined
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  }

  const sortNodes = (nodes: KbTreeNode[]) => {
    nodes.sort((a, b) => a.sort - b.sort || a.id - b.id)
    for (const n of nodes) sortNodes(n.children)
  }
  sortNodes(roots)
  return roots
}

/** 深度优先查找节点 */
export function findNode(nodes: KbTreeNode[], id: number): KbTreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findNode(n.children, id)
    if (hit) return hit
  }
  return undefined
}

/** 收集某节点的全部后代 id（删除目录时连带判断） */
export function descendantIds(node: KbTreeNode): number[] {
  const out: number[] = []
  const walk = (n: KbTreeNode) => {
    for (const c of n.children) {
      out.push(c.id)
      walk(c)
    }
  }
  walk(node)
  return out
}

/** target 是否是 node 的后代（拖拽移动时禁止把目录拖进自己子树） */
export function isDescendant(flat: KbDoc[], nodeId: number, targetId: number): boolean {
  const childrenOf = (pid: number) => flat.filter((d) => d.parentId === pid)
  const stack = childrenOf(nodeId)
  while (stack.length) {
    const cur = stack.pop()!
    if (cur.id === targetId) return true
    stack.push(...childrenOf(cur.id))
  }
  return false
}

/** 首个可选文档（DOC 类型，树序）——进空间默认选中 */
export function firstDoc(nodes: KbTreeNode[]): KbTreeNode | undefined {
  for (const n of nodes) {
    if (n.type === "DOC") return n
    const inner = firstDoc(n.children)
    if (inner) return inner
  }
  return undefined
}
