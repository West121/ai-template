package com.xingchen.oa.office.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDate;
import java.util.List;

/**
 * 发起审批：applicant / dept 由当前登录身份自动填充。
 */
public record ApprovalCreateRequest(
        @NotBlank(message = "标题不能为空") String title,
        @NotBlank(message = "类型不能为空") String type,
        @NotBlank(message = "事由不能为空") String reason,
        LocalDate startDate,
        LocalDate endDate,
        /** 抄送用户 id 列表，可空 */
        List<Long> ccUserIds
) {
}
