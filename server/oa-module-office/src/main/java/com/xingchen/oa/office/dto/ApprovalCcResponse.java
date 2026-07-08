package com.xingchen.oa.office.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 抄送我的审批：追加已读标记。
 */
public record ApprovalCcResponse(
        Long id,
        String title,
        String type,
        String applicant,
        Long applicantId,
        String status,
        String reason,
        Long deptId,
        String deptName,
        LocalDate startDate,
        LocalDate endDate,
        LocalDateTime createdAt,
        Boolean readFlag
) {
}
