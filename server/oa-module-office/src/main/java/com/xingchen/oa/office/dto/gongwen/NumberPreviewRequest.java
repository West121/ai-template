package com.xingchen.oa.office.dto.gongwen;

/**
 * 文号预览（不占号）。ruleId 可空 → 按 docType 解析规则。
 */
public record NumberPreviewRequest(
        Long ruleId,
        String docType
) {
}
