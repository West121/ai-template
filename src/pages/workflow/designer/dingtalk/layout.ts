/** 仿钉钉审批流：模型树 → react-flow nodes/edges 的自动布局（从 demo/approval-flow 抽出复用） */
import type { Edge, Node } from "@xyflow/react"
import { isBranchContainer, type Branch, type StepNode } from "./model"

/** 卡片与布局常量 */
export const CARD_W = 256
export const CARD_H = 78
const DOT = 12
const V_GAP = 52
const LANE_GAP = 48
const LANE_MIN = CARD_W + LANE_GAP

/** 一条步骤列表需要占用的横向宽度（递归考虑条件分支并排） */
function listWidth(steps: StepNode[]): number {
  let width = CARD_W
  for (const step of steps) {
    if (isBranchContainer(step)) {
      const total = step.branches.reduce((sum, branch) => sum + branchWidth(branch), 0)
      width = Math.max(width, total)
    }
  }
  return width
}

function branchWidth(branch: Branch): number {
  return Math.max(LANE_MIN, listWidth(branch.steps) + LANE_GAP)
}

interface BuildResult {
  nodes: Node[]
  edges: Edge[]
}

let edgeSeq = 0

function insertEdge(source: string, target: string, listId: string, index: number): Edge {
  return {
    id: `e${++edgeSeq}`,
    source,
    target,
    type: "insert",
    data: { listId, index },
    style: { stroke: "var(--border)", strokeWidth: 1.5 },
  }
}

function plainEdge(source: string, target: string): Edge {
  return {
    id: `e${++edgeSeq}`,
    source,
    target,
    type: "smoothstep",
    style: { stroke: "var(--border)", strokeWidth: 1.5 },
  }
}

/**
 * 递归排布一条步骤列表。
 * @returns 列表结束后的 y 坐标与最后一个节点 id（供后续接边）
 */
function walkList(
  steps: StepNode[],
  listId: string,
  centerX: number,
  y: number,
  prevId: string,
  out: BuildResult,
): { y: number; prevId: string } {
  let cursorY = y
  let prev = prevId

  steps.forEach((step, index) => {
    if (isBranchContainer(step)) {
      // 分叉点（小圆点）：上一节点 → 分叉点的边承载「在分支前插入」
      const splitId = `${step.id}-split`
      out.nodes.push({
        id: splitId,
        type: "dot",
        position: { x: centerX - DOT / 2, y: cursorY },
        data: {},
        draggable: false,
      })
      out.edges.push(insertEdge(prev, splitId, listId, index))
      cursorY += DOT + V_GAP

      const widths = step.branches.map(branchWidth)
      const total = widths.reduce((a, b) => a + b, 0)
      let laneX = centerX - total / 2
      const headY = cursorY
      const tails: Array<{ id: string; y: number }> = []

      step.branches.forEach((branch, branchIndex) => {
        const laneCenter = laneX + widths[branchIndex] / 2
        laneX += widths[branchIndex]

        out.nodes.push({
          id: branch.id,
          type: "branch",
          position: { x: laneCenter - CARD_W / 2, y: headY },
          data: {
            branch,
            conditionId: step.id,
            containerKind: step.kind,
            priority: branchIndex + 1,
            branchCount: step.branches.length,
            // 并行分支无默认分支；条件/包容最后一条为默认
            isDefault: step.kind !== "parallel" && branchIndex === step.branches.length - 1,
          },
          draggable: false,
        })
        out.edges.push(plainEdge(splitId, branch.id))

        const inner = walkList(branch.steps, branch.id, laneCenter, headY + CARD_H + V_GAP, branch.id, out)
        tails.push({ id: inner.prevId, y: inner.y })
      })

      // 汇聚点
      const mergeY = Math.max(...tails.map((t) => t.y))
      const mergeId = `${step.id}-merge`
      out.nodes.push({
        id: mergeId,
        type: "dot",
        position: { x: centerX - DOT / 2, y: mergeY },
        data: {},
        draggable: false,
      })
      step.branches.forEach((branch, branchIndex) => {
        // 分支尾 → 汇聚点：支持在分支末尾追加节点
        out.edges.push(insertEdge(tails[branchIndex].id, mergeId, branch.id, branch.steps.length))
      })
      cursorY = mergeY + DOT + V_GAP
      prev = mergeId
    } else {
      out.nodes.push({
        id: step.id,
        type: "step",
        position: { x: centerX - CARD_W / 2, y: cursorY },
        data: { step },
        draggable: false,
      })
      out.edges.push(insertEdge(prev, step.id, listId, index))
      cursorY += CARD_H + V_GAP
      prev = step.id
    }
  })

  return { y: cursorY, prevId: prev }
}

/** 模型 → react-flow 的 nodes / edges */
export function buildFlow(steps: StepNode[]): BuildResult {
  edgeSeq = 0
  const out: BuildResult = { nodes: [], edges: [] }
  const centerX = 0

  out.nodes.push({
    id: "start",
    type: "start",
    position: { x: centerX - CARD_W / 2, y: 0 },
    data: {},
    draggable: false,
  })

  const { y, prevId } = walkList(steps, "root", centerX, CARD_H + V_GAP, "start", out)

  out.nodes.push({
    id: "end",
    type: "end",
    position: { x: centerX - CARD_W / 2, y },
    data: {},
    draggable: false,
  })
  out.edges.push(insertEdge(prevId, "end", "root", steps.length))

  return out
}
