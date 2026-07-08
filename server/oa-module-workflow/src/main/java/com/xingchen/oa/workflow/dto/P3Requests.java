package com.xingchen.oa.workflow.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;
import java.util.Map;

/**
 * P3 高级能力请求 DTO 集合。选人入参统一用 {@link OrgRef}。
 */
public final class P3Requests {

    private P3Requests() {
    }

    /** 唤醒：已结束实例按快照重建新实例并定位到 nodeId 重审。 */
    public record ResurrectRequest(@NotBlank String nodeId, String comment) {
    }

    /** 电子章创建/更新。 */
    public record SealRequest(String name, Long imageFileId, Boolean enabled) {
    }

    /** 动态构建 ad-hoc 任务（不体现在流程图，服务层管理完成条件）。 */
    public record AdhocTaskRequest(String name, List<OrgRef> assignees, Boolean requireAll) {
    }

    /** 流程预测响应：后续将经过节点 + 预计审批人。 */
    public record PredictResponse(List<PredictNode> path, String note) {

        public record PredictNode(String nodeId, String nodeName, String type, List<AssigneeName> assignees) {
        }

        public record AssigneeName(String name) {
        }
    }

    /** 电子章列表项。 */
    public record SealItem(Long id, String name, Long imageFileId, String imageUrl,
                           boolean enabled, java.time.OffsetDateTime createdAt) {
    }

    /** 预测辅助：条件求值上下文（合并表单 + 流程变量）。 */
    public record PredictContext(Long initiatorId, Long initiatorDeptId, Map<String, Object> values) {
    }
}
