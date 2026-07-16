package com.hentor.oa.office.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;

public record MeetingCreateRequest(
        @NotNull(message = "会议室不能为空") Long roomId,
        @NotBlank(message = "会议主题不能为空") String subject,
        @NotNull(message = "会议日期不能为空") LocalDate date,
        @NotNull(message = "开始时间不能为空") Integer startHour,
        @NotNull(message = "结束时间不能为空") Integer endHour
) {
}
