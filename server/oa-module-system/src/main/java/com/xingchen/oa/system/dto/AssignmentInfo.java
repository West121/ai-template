package com.xingchen.oa.system.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * 任职信息（登录响应 / 身份切换用）。JSON 字段名为 primary（Java 关键字，故组件名用 isPrimary）。
 */
public record AssignmentInfo(
        Long id,
        Long deptId,
        String deptName,
        String postName,
        List<String> roleNames,
        @JsonProperty("primary") boolean isPrimary
) {
}
