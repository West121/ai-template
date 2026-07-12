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

    /**
     * 唤醒：已结束实例按快照重建新实例并定位到 nodeId 重审。
     *
     * <p>{@code assignees} 可选（复用 2D 选人模型 {@link OrgRef}，与加签/转办同源）：
     * 传了则覆盖 nodeId 的办理人为所选；不传（null/空）则维持节点规则解析（向后兼容）。
     */
    public record ResurrectRequest(@NotBlank String nodeId, String comment, List<OrgRef> assignees) {
    }

    /**
     * 唤醒选人预览：前端选节点后拉取，默认回填该节点办理人。
     *
     * @param nodeName         节点名
     * @param historyAssignees 原（已结束）实例该 nodeId 最后一次办理人（act_hi_taskinst，多人取全部）
     * @param ruleAssignees    节点规则默认解析结果（兜底，与不传 assignees 时一致）
     */
    public record ResurrectPreview(String nodeName,
                                   List<AssigneeRef> historyAssignees,
                                   List<AssigneeRef> ruleAssignees) {

        public record AssigneeRef(Long id, String name) {
        }
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
