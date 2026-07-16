package com.hentor.oa.workflow.dto;

import com.hentor.oa.workflow.entity.WfNotify;

import java.time.OffsetDateTime;

public record NotifyItem(
        Long id,
        String type,
        String title,
        String content,
        String procInstId,
        Boolean readFlag,
        OffsetDateTime createdAt) {

    public static NotifyItem of(WfNotify n) {
        return new NotifyItem(n.getId(), n.getType(), n.getTitle(), n.getContent(),
                n.getProcInstId(), n.getReadFlag(), n.getCreatedAt());
    }
}
