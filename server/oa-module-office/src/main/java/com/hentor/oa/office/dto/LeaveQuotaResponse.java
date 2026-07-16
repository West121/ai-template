package com.hentor.oa.office.dto;

public record LeaveQuotaResponse(
        String type,
        Double total,
        Double used
) {
}
