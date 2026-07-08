package com.xingchen.oa.workflow.dto;

import java.time.OffsetDateTime;

public record TaskItem(
        String taskId,
        String procInstId,
        String instanceTitle,
        String defName,
        String nodeName,
        String initiatorName,
        OffsetDateTime createdAt,
        boolean groupClaim,
        boolean delegated) {
}
