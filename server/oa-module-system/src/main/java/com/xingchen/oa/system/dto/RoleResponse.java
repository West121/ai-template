package com.xingchen.oa.system.dto;

import com.xingchen.oa.system.entity.SysRole;

import java.util.List;

public record RoleResponse(
        Long id,
        String code,
        String name,
        String dataScope,
        Boolean enabled,
        long userCount,
        String remark,
        List<Long> customDeptIds
) {
    public static RoleResponse of(SysRole role, long userCount) {
        return new RoleResponse(
                role.getId(),
                role.getCode(),
                role.getName(),
                role.getDataScope(),
                role.getEnabled(),
                userCount,
                null,
                role.getCustomDeptIds() == null ? List.of()
                        : role.getCustomDeptIds().stream().sorted().toList()
        );
    }
}
