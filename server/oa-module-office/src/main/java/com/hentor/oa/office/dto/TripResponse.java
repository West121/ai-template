package com.hentor.oa.office.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;

public record TripResponse(
        Long id,
        String destination,
        LocalDate startDate,
        LocalDate endDate,
        String transport,
        Double budget,
        String reason,
        String status,
        String applicant,
        String deptName,
        LocalDateTime createdAt
) {
}
