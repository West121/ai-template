package com.xingchen.oa.workflow.dto;

import jakarta.validation.constraints.NotBlank;

/** 流程定义创建/更新请求。designerType=DINGTALK 时提供 designerJson；=BPMN 时提供 bpmnXml。 */
public record ProcessDefRequest(
        @NotBlank String defCode,
        @NotBlank String name,
        String category,
        String icon,
        String formCode,
        Integer formVersion,
        String designerType,
        String designerJson,
        String bpmnXml,
        String remark,
        // P1-C 自定义表单 + 流程级配置
        String formType,
        String formSubmitPath,
        String formViewPath,
        String flowConfig) {
}
