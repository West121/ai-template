package com.xingchen.oa.system.dto;

import com.xingchen.oa.system.entity.SysRole;

public record RoleResponse(
        Long id,
        String code,
        String name,
        String dataScope,
        Boolean enabled,
        long userCount,
        String remark
) {
    public static RoleResponse of(SysRole role, long userCount) {
        return new RoleResponse(
                role.getId(),
                role.getCode(),
                role.getName(),
                role.getDataScope(),
                role.getEnabled(),
                userCount,
                null
        );
    }
}
