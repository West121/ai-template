package com.hentor.oa.office.dto.gongwen;

import jakarta.validation.constraints.NotBlank;

/**
 * 发文拟稿（起 gw_send 流程）。
 */
public record SendDraftRequest(
        @NotBlank(message = "标题不能为空") String title,
        String docType,
        /** 文头类型 RED 红头 / PLAIN 白头；可空缺省 RED。 */
        String headerType,
        String issuingOrg,
        String mainRecipients,
        String ccRecipients,
        String secret,
        String urgency,
        String copyNo,
        String issuer,
        String annotation,
        String content,
        String attachments,
        Long templateId,
        Long numberRuleId,
        Boolean needCountersign
) {
}
