/**
 * 公文 → 基座归一化适配（重构阶段 D）。
 *
 * 把公文办文意见 `GwOpinion[]` 适配为基座 `WfTimelineItem[]`，喂 WorkflowDetailShell 的内建办理记录
 * 与 WorkflowFlowTrack 的图内 nodeInfo（逐节点办理信息回填）：
 *  - nodeId → nodeId（磐石补，对齐 gw_send/gw_recv designerJson 节点 id，图内高亮/回填的前提）
 *  - taskKey → nodeName（环节名徽标：拟稿/核稿/签发/用印/拟办/批办/承办/传阅…）
 *  - userName → actorName ; opinion → comment ; decision → action（DECISION_META 收敛：AGREE/REJECT/
 *    TRANSFER/SIGN/SEAL/SUBMIT/READ/URGE/ARCHIVE）; createdAt 原样
 * 决策色/文案由基座 `timelineMeta=DECISION_META` 承载；REJECT→rejected、URGE 归 NON_HANDLER（buildNodeInfo）。
 */
import type { WfTimelineItem } from "@/types/workflow"
import type { GwOpinion } from "./types"

export function opinionsToTimeline(opinions: GwOpinion[] | undefined): WfTimelineItem[] {
  return (opinions ?? []).map((o) => ({
    nodeId: o.nodeId,
    nodeName: o.taskKey,
    actorName: o.userName,
    action: o.decision,
    comment: o.opinion || undefined,
    createdAt: o.createdAt,
  }))
}
