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

    /**
     * 流程预测响应：从流程起点到终点的<b>完整链路</b>（已完成 + 当前 + 后续）+ 预计办理人。
     *
     * <p>{@code path} 每个节点带 {@link PredictNode#status()}（done/current/future）；已结束实例全链路皆 done。
     */
    public record PredictResponse(List<PredictNode> path, String note) {

        /**
         * 预测链路节点。
         *
         * @param nodeId        节点 id（designer 图节点 id，= Flowable activityId）
         * @param nodeName      节点名
         * @param type          节点类型（向后兼容既有字段：approval/cc/condition/parallel/start/...）
         * @param assignees     预计办理人（approval 节点按规则离线求值；其余空）
         * @param status        链路状态：{@code done}(已完成) / {@code current}(当前活动) / {@code future}(后续)
         * @param nodeType      节点类型（= type，如实输出，供前端按类型渲染图标；与 type 同值，保留兼容）
         * @param canReject     审批节点是否可驳回（流程级未关闭 reject + 节点 allowedOps 未排除 reject）
         * @param rejectTo      驳回回退目标 {nodeId,name}（回发起人 / 回上一审批节点），不可驳回时 null
         * @param multiMode     approval 并签模式：ALL(会签)/ANY(或签)/SEQUENCE(顺序)/VOTE(票签)，非审批节点 null
         * @param parallelGroup 并行网关分组 id（同组前端并排渲染），非并行分支内节点 null
         */
        public record PredictNode(String nodeId, String nodeName, String type, List<AssigneeName> assignees,
                                  String status, String nodeType, boolean canReject, RejectTarget rejectTo,
                                  String multiMode, String parallelGroup) {

            /** 向后兼容便捷构造：仅基础字段（status=future、无驳回/并签/并行信息）。 */
            public PredictNode(String nodeId, String nodeName, String type, List<AssigneeName> assignees) {
                this(nodeId, nodeName, type, assignees, "future", type, false, null, null, null);
            }
        }

        /** 驳回回退目标节点（回发起人 = 起点节点；回上一审批节点 = 前一 approval）。 */
        public record RejectTarget(String nodeId, String name) {
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
