package com.xingchen.oa.office.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;

public record ScheduleCreateRequest(
        @NotBlank(message = "日程标题不能为空") String title,
        @NotNull(message = "日程日期不能为空") LocalDate date,
        /** HH:mm */
        String startTime,
        String endTime,
        String place,
        @NotBlank(message = "日程类型不能为空") String type
) {
}
