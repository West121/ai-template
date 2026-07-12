package com.xingchen.oa.system.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.Set;

/**
 * 角色新增/修改请求。remark 当前库表未落列，仅透传（不持久化）。
 * customDeptIds 仅在 dataScope=CUSTOM 时生效（自定义可见部门集合，落 sys_role_dept）；
 * 其它数据范围下忽略并清空，避免脏数据。
 */
public record RoleRequest(
        @NotBlank(message = "角色编码不能为空") String code,
        @NotBlank(message = "角色名称不能为空") String name,
        @NotBlank(message = "数据范围不能为空") String dataScope,
        String remark,
        Boolean enabled,
        Set<Long> customDeptIds
) {
}
