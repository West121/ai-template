package com.xingchen.oa.office.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;

public record ApprovalResponse(
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
        LocalDateTime createdAt
) {
}
