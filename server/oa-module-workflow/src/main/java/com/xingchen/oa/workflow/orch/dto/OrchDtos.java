package com.xingchen.oa.workflow.orch.dto;

import java.time.OffsetDateTime;
import java.util.List;

/** 编排域 DTO（聚合，均为纯 record）。 */
public final class OrchDtos {

    private OrchDtos() {
    }

    /** 编排定义（详情含 designerJson；列表置 null 减载）。 */
    public record FlowResponse(
            Long id, String code, String name, String designerJson,
            String triggerType, String triggerConfig, String webhookToken,
            Boolean enabled, Integer version, Long errorFlowId, String remark,
            OffsetDateTime createdAt, OffsetDateTime updatedAt,
            String lastExecStatus, OffsetDateTime lastExecAt) {
    }

    public record FlowRequest(String code, String name, String designerJson,
                              String remark, Long errorFlowId) {
    }

    public record EnableRequest(Boolean enabled) {
    }

    public record ExecResponse(
            Long id, Long flowId, String flowCode, String triggerKind, String status,
            String payload, String result, String error,
            OffsetDateTime startedAt, OffsetDateTime endedAt,
            String resumeToken, Integer currentSegment, Long parentExecId) {
    }

    public record ExecNodeResponse(
            Long id, String nodeId, String nodeName, String status, Integer attempts,
            String input, String output, String error, Long costMs, OffsetDateTime startedAt) {
    }

    public record ExecDetailResponse(ExecResponse exec, List<ExecNodeResponse> nodes) {
    }

    /** 凭据（key 只写不回显；hasKey 供前端标识；supportsVision=LLM 视觉能力 §11）。 */
    public record CredentialResponse(
            Long id, String name, String type, String baseUrl, String model,
            String headerName, Boolean enabled, Boolean supportsVision, boolean hasKey, OffsetDateTime createdAt) {
    }

    public record CredentialRequest(String name, String type, String baseUrl,
                                    String apiKey, String model, String headerName, Boolean enabled,
                                    Boolean supportsVision) {
    }
}
