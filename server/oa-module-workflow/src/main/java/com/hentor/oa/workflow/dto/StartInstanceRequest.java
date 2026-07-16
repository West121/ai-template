package com.hentor.oa.workflow.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.Map;

/**
 * 发起流程实例。formData 为动态表单数据（原样快照 + 扁平化为流程变量供条件判断）。
 * bizTime（P3 穿越时空，可选 ISO 日期/时间）：补审时记录业务时间，展示/报表用，引擎真实时间不动。
 */
public record StartInstanceRequest(
        @NotBlank String defCode,
        Map<String, Object> formData,
        String title,
        String bizTime) {
}
