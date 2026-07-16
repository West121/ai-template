package com.hentor.oa.workflow.dto;

import java.util.Map;

/** 退回发起人后重新提交（可改表单）。 */
public record ResubmitRequest(Map<String, Object> formData) {
}
