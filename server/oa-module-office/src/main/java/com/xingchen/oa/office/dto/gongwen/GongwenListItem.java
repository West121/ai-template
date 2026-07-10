package com.xingchen.oa.office.dto.gongwen;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 发文/收文列表项（台账/登记簿视图）。
 */
public record GongwenListItem(
        Long id,
        String direction,
        String code,
        String title,
        String docType,
        String headerType,
        String secret,
        String urgency,
        String status,
        String unit,
        String drafter,
        String signer,
        String sealStatus,
        Boolean archived,
        String archiveNo,
        LocalDate docDate,
        Long deptId,
        String deptName,
        LocalDateTime createdAt
) {
}
