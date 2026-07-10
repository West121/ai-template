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
        List<TimelineItem> timeline,
        List<Circulation> circulations
) {
    /** 当前待办环节。 */
    public record CurrentTask(String taskId, String taskKey, String taskName, String assignee) {
    }

    /** 时间线项（办文意见）。 */
    public record TimelineItem(Long id, String taskKey, Long userId, String userName,
                               String opinion, String decision, LocalDateTime createdAt) {
    }

    /** 传阅回执。 */
    public record Circulation(Long id, Long readerId, String readerName, String status,
                              LocalDateTime readAt, String opinion, LocalDateTime createdAt) {
    }
}
