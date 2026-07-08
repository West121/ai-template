package com.xingchen.oa.system.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 添加兼任任职（primary 恒为 false，服务端强制）。
 */
public record AssignmentCreateRequest(
        @NotNull(message = "部门不能为空") Long deptId,
        @NotNull(message = "岗位不能为空") Long postId,
        List<Long> roleIds,
        @JsonProperty("primary") Boolean isPrimary
) {
}
