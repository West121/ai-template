package com.xingchen.oa.workflow.dto;

import com.xingchen.oa.workflow.entity.WfInstanceExt;

import java.time.OffsetDateTime;

public record InstanceListItem(
        Long id,
        String procInstId,
        String defCode,
        String defName,
        String title,
        String bizStatus,
        Long initiatorId,
        String initiatorName,
        OffsetDateTime createdAt,
        OffsetDateTime endedAt) {

    public static InstanceListItem of(WfInstanceExt e) {
        return new InstanceListItem(e.getId(), e.getProcInstId(), e.getDefCode(), e.getDefName(), e.getTitle(),
                e.getBizStatus(), e.getInitiatorId(), e.getInitiatorName(), e.getCreatedAt(), e.getEndedAt());
    }
}
