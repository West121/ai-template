package com.xingchen.oa.system.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 角色权限全量替换请求。
 */
public record RolePermissionsRequest(
        @NotNull(message = "permissionIds 不能为空") List<Long> permissionIds
) {
}
