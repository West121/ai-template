package com.xingchen.oa.system.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 角色新增/修改请求。remark 当前库表未落列，仅透传（不持久化）。
 */
public record RoleRequest(
        @NotBlank(message = "角色编码不能为空") String code,
        @NotBlank(message = "角色名称不能为空") String name,
        @NotBlank(message = "数据范围不能为空") String dataScope,
        String remark,
        Boolean enabled
) {
}
