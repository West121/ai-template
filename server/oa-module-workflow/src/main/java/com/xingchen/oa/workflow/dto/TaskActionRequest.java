package com.xingchen.oa.workflow.dto;

import java.util.List;
import java.util.Map;

/** 审批通过请求（意见/附件/可选表单修改）。 */
public record TaskActionRequest(
        String comment,
        List<Long> attachments,
        Map<String, Object> formData) {
}
