package com.hentor.oa.workflow.dto;

import java.time.OffsetDateTime;

public record CcItem(
        Long id,
        String procInstId,
        String title,
        String defName,
        String initiatorName,
        String bizStatus,
        Boolean readFlag,
        OffsetDateTime createdAt) {
}
