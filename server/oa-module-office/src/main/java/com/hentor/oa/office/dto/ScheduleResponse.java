package com.hentor.oa.office.dto;

import java.time.LocalDate;

public record ScheduleResponse(
        Long id,
        String title,
        LocalDate date,
        String startTime,
        String endTime,
        String place,
        String type
) {
}
