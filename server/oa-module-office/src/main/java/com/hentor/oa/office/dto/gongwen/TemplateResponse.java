package com.hentor.oa.office.dto.gongwen;

/**
 * 红头/正文套版模板。
 */
public record TemplateResponse(
        Long id,
        String code,
        String name,
        String type,
        String issuingOrg,
        String content,
        Long sealImageId,
        Boolean enabled
) {
}
