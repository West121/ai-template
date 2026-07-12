package com.xingchen.oa.office.dto.gongwen;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 公文详情：版式字段 + 办理时间线(opinions) + 传阅回执 + 当前 Flowable 环节。
 */
public record DocDetailResponse(
        Long id,
        String direction,
        String code,
        String title,
        String docType,
        String headerType,
        String issuingOrg,
        String secret,
        LocalDate secretExpire,
        String urgency,
        String status,
        String unit,
        String mainRecipients,
        String ccRecipients,
        String copyNo,
        String issuer,
        String annotation,
        String drafter,
        String signer,
        String content,
        LocalDate docDate,
        String sealStatus,
        String sealedBy,
        LocalDateTime sealedAt,
        Boolean archived,
        String archiveNo,
        Long templateId,
        Long deptId,
        String deptName,
        String processInstanceId,
        LocalDateTime createdAt,
        CurrentTask currentTask,
        Highlight highlight,
        List<TimelineItem> timeline,
        List<Circulation> circulations
) {
    /**
     * 流程图高亮（只读 FlowViewer 用）：元素为 designerJson 的节点 id（= BPMN 元素 id），
     * 与节点 id 原值对齐（review/issue…），非中文名。已办结实例 active 空、completed 覆盖全程。
     */
    public record Highlight(List<String> completed, List<String> active) {
    }

    /** 当前待办环节。 */
    public record CurrentTask(String taskId, String taskKey, String taskName, String assignee) {
    }

    /**
     * 时间线项（办文意见）。nodeId = 办理节点 activity id（= 流程图节点 id，与 highlight 同口径），
     * 供前端流程图（WorkflowFlowTrack）按 nodeId 逐节点回填办理信息；起始事件为 'start'，老数据可能为空。
     */
    public record TimelineItem(Long id, String taskKey, String nodeId, Long userId, String userName,
                               String opinion, String decision, LocalDateTime createdAt) {
    }

    /** 传阅回执。 */
    public record Circulation(Long id, Long readerId, String readerName, String status,
                              LocalDateTime readAt, String opinion, LocalDateTime createdAt) {
    }
}
