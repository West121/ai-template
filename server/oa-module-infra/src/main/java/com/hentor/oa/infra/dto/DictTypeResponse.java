package com.hentor.oa.infra.dto;

import com.hentor.oa.infra.entity.SysDictType;

/**
 * 契约 DictType = {id,code,name,remark,enabled,itemCount}
 */
public record DictTypeResponse(
        Long id,
        String code,
        String name,
        String remark,
        Boolean enabled,
        long itemCount) {

    public static DictTypeResponse of(SysDictType t, long itemCount) {
        return new DictTypeResponse(t.getId(), t.getCode(), t.getName(), t.getRemark(), t.getEnabled(), itemCount);
    }
}
