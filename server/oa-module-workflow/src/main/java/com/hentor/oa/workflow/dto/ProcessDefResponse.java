package com.hentor.oa.workflow.dto;

import com.hentor.oa.workflow.entity.WfProcessExt;

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
                WfProcessExt.canonicalFormType(e.getFormType()), e.getFormSubmitPath(), e.getFormViewPath(), e.getFlowConfig());
    }

    /** 返回时补 name 用：以补全后的 designerJson / flowConfig 生成副本，其余字段不变。 */
    public ProcessDefResponse withEnriched(String enrichedDesignerJson, String enrichedFlowConfig) {
        return new ProcessDefResponse(id, defCode, name, category, icon, formCode, formVersion, designerType,
                enrichedDesignerJson, bpmnXml, status, processDefinitionId, remark, createdAt,
                formType, formSubmitPath, formViewPath, enrichedFlowConfig);
    }
}
