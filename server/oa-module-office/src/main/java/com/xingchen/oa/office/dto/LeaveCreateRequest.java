package com.xingchen.oa.office.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;

public record LeaveCreateRequest(
        @NotBlank(message = "请假类型不能为空") String type,
        @NotNull(message = "开始日期不能为空") LocalDate startDate,
        @NotNull(message = "结束日期不能为空") LocalDate endDate,
        @NotNull(message = "请假天数不能为空") Double days,
        @NotBlank(message = "请假事由不能为空") String reason
) {
}
