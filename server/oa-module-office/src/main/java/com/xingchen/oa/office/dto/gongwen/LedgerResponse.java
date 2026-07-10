package com.xingchen.oa.office.dto.gongwen;

import java.time.LocalDateTime;

/**
 * 文号台账项。
 */
public record LedgerResponse(
        Long id,
        String docNumber,
        Long ruleId,
        Long documentId,
        String docTitle,
        String issuer,
        String status,
        LocalDateTime issuedAt
) {
}
