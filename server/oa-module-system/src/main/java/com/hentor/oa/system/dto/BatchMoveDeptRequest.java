package com.hentor.oa.system.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 批量移动部门请求体：{ids, deptId}（deptId = 目标部门，落到各用户的主任职）。
 */
public record BatchMoveDeptRequest(
        @NotEmpty(message = "ids 不能为空") List<Long> ids,
        @NotNull(message = "deptId 不能为空") Long deptId) {
}
