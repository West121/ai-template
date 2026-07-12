/**
 * 唤醒重新选人 · 预览取数（mock 先行）。
 *
 * GET /api/wf/instances/{id}/resurrect-preview?nodeId= → {nodeName, historyAssignees, ruleAssignees}。
 * 磐石后端 resurrect-preview 契约进行中：端点 404 / 网络不可用 → 由 timeline 派生**演示预填**
 * （原节点历史办理人，负 id 表演示），demo=true；真实端点就绪后自动切真实数据。
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import type { WfTimelineItem } from "@/types/workflow"
import type { WfResurrectPreview } from "@/types/workflow-p3"

/** 由 timeline 派生某节点历史办理人（去重、保序）——演示预填用（无真实 id，负 id 占位） */
export function mockResurrectPreview(
  nodeId: string,
  nodeName: string | undefined,
  timeline: WfTimelineItem[] | undefined,
): WfResurrectPreview {
  const names: string[] = []
  for (const t of timeline ?? []) {
    if (t.nodeId === nodeId && t.actorName && !names.includes(t.actorName)) names.push(t.actorName)
  }
  return {
    nodeName,
    historyAssignees: names.map((name, i) => ({ id: -(i + 1), name })),
    ruleAssignees: [{ name: "按节点规则运行时确定" }],
  }
}

/** 归一 historyAssignees（后端字段容错，防白屏：非数组 → []） */
function normalizeHistory(raw: unknown): { id: number; name: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((h) => {
      const o = (h ?? {}) as { id?: unknown; name?: unknown }
      const id = o.id == null ? NaN : Number(o.id)
      return { id, name: String(o.name ?? "") }
    })
    .filter((h) => Number.isFinite(h.id) && h.id > 0 && h.name)
}

export interface ResurrectPreviewResult {
  data: WfResurrectPreview
  /** true=演示预填（端点未就绪，由 timeline 派生） */
  demo: boolean
}

/** 取唤醒预览：真实端点优先；404/网络不可用回退 timeline 派生的演示数据 */
export async function fetchResurrectPreview(
  instanceId: number,
  nodeId: string,
  nodeName: string | undefined,
  timeline: WfTimelineItem[] | undefined,
): Promise<ResurrectPreviewResult> {
  try {
    const data = await api<WfResurrectPreview>(
      `/api/wf/instances/${instanceId}/resurrect-preview?nodeId=${encodeURIComponent(nodeId)}`,
    )
    return {
      data: {
        nodeName: data.nodeName ?? nodeName,
        historyAssignees: normalizeHistory(data.historyAssignees),
        ruleAssignees: Array.isArray(data.ruleAssignees) ? data.ruleAssignees : undefined,
      },
      demo: false,
    }
  } catch (err) {
    if (err instanceof NetworkError || (err instanceof ApiError && err.code === 404)) {
      return { data: mockResurrectPreview(nodeId, nodeName, timeline), demo: true }
    }
    throw err
  }
}
