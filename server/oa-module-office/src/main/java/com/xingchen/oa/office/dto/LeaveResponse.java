package com.xingchen.oa.office.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;

public record LeaveResponse(
        Long id,
        String type,
        LocalDate startDate,
        LocalDate endDate,
        Double days,
        String reason,
        String status,
        String applicant,
        String deptName,
        LocalDateTime createdAt
) {
}
