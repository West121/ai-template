package com.xingchen.oa.system.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 身份切换请求：assignmentId 为任职 id 字符串，或 "ALL" 表示全部身份并集。
 */
public record SwitchAssignmentRequest(
        @NotBlank(message = "assignmentId 不能为空") String assignmentId
) {
}
