package com.xingchen.oa.workflow.dto;

import com.xingchen.oa.workflow.entity.WfFormDef;

import java.time.OffsetDateTime;

public record FormDefResponse(
        Long id,
        String code,
        String name,
        Integer version,
        String schemaJson,
        String status,
        String remark,
        OffsetDateTime createdAt) {

    public static FormDefResponse of(WfFormDef e) {
        return new FormDefResponse(e.getId(), e.getCode(), e.getName(), e.getVersion(),
                e.getSchemaJson(), e.getStatus(), e.getRemark(), e.getCreatedAt());
    }
}
