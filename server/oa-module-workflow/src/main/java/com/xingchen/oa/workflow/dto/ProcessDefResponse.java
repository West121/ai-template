package com.xingchen.oa.workflow.dto;

import com.xingchen.oa.workflow.entity.WfProcessExt;

import java.time.OffsetDateTime;

public record ProcessDefResponse(
        Long id,
        String defCode,
        String name,
        String category,
        String icon,
        String formCode,
        Integer formVersion,
        String designerType,
        String designerJson,
        String bpmnXml,
        String status,
        String processDefinitionId,
        String remark,
        OffsetDateTime createdAt,
        // P1-C 自定义表单 + 流程级配置
        String formType,
        String formSubmitPath,
        String formViewPath,
        String flowConfig) {

    public static ProcessDefResponse of(WfProcessExt e) {
        return new ProcessDefResponse(e.getId(), e.getDefCode(), e.getName(), e.getCategory(), e.getIcon(),
                e.getFormCode(), e.getFormVersion(), e.getDesignerType(), e.getDesignerJson(), e.getBpmnXml(),
                e.getStatus(), e.getProcessDefinitionId(), e.getRemark(), e.getCreatedAt(),
                e.getFormType(), e.getFormSubmitPath(), e.getFormViewPath(), e.getFlowConfig());
    }
}
