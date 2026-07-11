package com.xingchen.oa.office.dto.bizdoc;

import tools.jackson.databind.JsonNode;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

/** BizDoc 域 DTO（聚合 record）。 */
public final class BizDocDtos {

    private BizDocDtos() {
    }

    /** 定义（submitPath=CODE 表单运行时发起路径，疾风批A契约）。 */
    public record DefResponse(
            Long id, String code, String name, String category, String icon,
            String formType, String formCode, String submitPath, JsonNode formSchema,
            Long numberRuleId, String wfDefCode, JsonNode listConfig,
            Long defaultPrintTplId, String status, String remark,
            OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    public record DefRequest(String code, String name, String category, String icon,
                             String formType, String formCode, String submitPath, JsonNode formSchema,
                             Long numberRuleId, String wfDefCode, JsonNode listConfig, String remark) {
    }

    /** 单据列表项（form_data 摘要按 listConfig columns 平铺进 fields）。 */
    public record DocItem(
            Long id, String defCode, String docNo, String title, String status,
            String creatorName, Long deptId, String deptName,
            String processInstanceId, Map<String, Object> fields,
            OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    public record DocDetail(
            Long id, Long defId, String defCode, String docNo, String title, String status,
            JsonNode formData, String processInstanceId,
            Long creatorId, String creatorName, Long deptId, String deptName,
            OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    public record DocRequest(String defCode, String title, JsonNode formData) {
    }

    public record PrintTplResponse(Long id, Long defId, String name, String paper,
                                   Boolean landscape, JsonNode content, Boolean isDefault,
                                   OffsetDateTime createdAt) {
    }

    public record PrintTplRequest(String name, String paper, Boolean landscape, JsonNode content) {
    }

    /** 打印数据（渲染在前端：套打设计器同一渲染器）。 */
    public record PrintData(PrintTplResponse tpl, Map<String, Object> data, List<Map<String, String>> fields) {
    }
}
