package com.xingchen.oa.office.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;

public record DocumentResponse(
        Long id,
        String direction,
        String code,
        String title,
        String unit,
        String secret,
        String urgency,
        String status,
        String drafter,
        String signer,
        String content,
        LocalDate docDate,
        Long deptId,
        String deptName,
        LocalDateTime createdAt
) {
}
