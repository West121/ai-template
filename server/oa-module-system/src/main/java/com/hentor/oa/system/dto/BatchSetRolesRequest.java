package com.hentor.oa.system.dto;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * 批量设置角色请求体：{ids, roleIds}（roleIds 全量替换各用户主任职上的角色集合；空集合=清空角色）。
 */
public record BatchSetRolesRequest(
        @NotEmpty(message = "ids 不能为空") List<Long> ids,
        List<Long> roleIds) {
}
