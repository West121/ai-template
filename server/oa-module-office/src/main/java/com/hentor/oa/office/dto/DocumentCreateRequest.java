package com.hentor.oa.office.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 新建发文（direction 固定为 SEND，code 自动生成）。
 */
public record DocumentCreateRequest(
        String direction,
        @NotBlank(message = "标题不能为空") String title,
        @NotBlank(message = "主送单位不能为空") String unit,
        @NotBlank(message = "密级不能为空") String secret,
        @NotBlank(message = "缓急不能为空") String urgency,
        String content
) {
}
