package com.hentor.oa.office.dto.gongwen;

/**
 * 文号规则（含下一个将占号的预览）。
 */
public record NumberRuleResponse(
        Long id,
        String code,
        String name,
        String orgCode,
        String docType,
        String pattern,
        String seqScope,
        Integer seqWidth,
        Boolean enabled,
        String nextPreview
) {
}
