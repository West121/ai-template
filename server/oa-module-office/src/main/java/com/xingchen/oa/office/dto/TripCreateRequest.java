package com.xingchen.oa.office.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;

public record TripCreateRequest(
        @NotBlank(message = "目的地不能为空") String destination,
        @NotNull(message = "开始日期不能为空") LocalDate startDate,
        @NotNull(message = "结束日期不能为空") LocalDate endDate,
        @NotBlank(message = "交通方式不能为空") String transport,
        Double budget,
        @NotBlank(message = "出差事由不能为空") String reason
) {
}
