package com.hentor.oa.office.dto;

import java.time.LocalDateTime;

public record ApprovalLogResponse(
        String action,
        String actorName,
        String comment,
        LocalDateTime createdAt
) {
}
