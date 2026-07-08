package com.xingchen.oa.workflow.dto;

import jakarta.validation.constraints.NotBlank;

/** 表单定义创建/更新请求。schemaJson 为前端表单设计器 widgets JSON，原样存取。 */
public record FormDefRequest(
        @NotBlank String code,
        @NotBlank String name,
        @NotBlank String schemaJson,
        String remark) {
}
