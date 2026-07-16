package com.hentor.oa.office.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 我处理过的审批：在通用字段基础上追加我的操作与操作时间。
 */
public record ApprovalDoneResponse(
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
        String myAction,
        LocalDateTime actedAt
) {
}
