package com.xingchen.oa.workflow.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;
import java.util.Map;

/**
 * P2 任务/流转/治理操作请求 DTO 集合（记录类型，集中声明便于维护）。
 * 选人入参统一用 {@link OrgRef}（kind=USER|DEPT|ROLE + id）。
 */
public final class P2Requests {

    private P2Requests() {
    }

    /** 加签：mode=PRE（被加签人先审再回到我）| POST（我通过后加签人审再进下节点）。 */
    public record AddSignRequest(String mode, List<OrgRef> users, String comment) {
    }

    /** 并签：追加平行审批人，与我同时审。 */
    public record CounterSignRequest(List<OrgRef> users, String comment) {
    }

    /** 减签：移除本节点未办理的其他审批人（剩余≥1）。 */
    public record ReduceSignRequest(List<Long> removeUserIds) {
    }

    /** 转办 / 委派：单个目标处理人。 */
    public record AssigneeRequest(OrgRef user, String comment) {
    }

    /** 协办/征求意见：多个协办人 + 必填意见诉求。 */
    public record AssistRequest(List<OrgRef> users, String comment) {
    }

    /** 沟通留言（不影响流转，通知对方）。 */
    public record CommunicateRequest(List<Long> toUserIds, @NotBlank String content) {
    }

    /** 拿回：我已办任务在下节点无人处理前取回重办。 */
    public record RetrieveRequest(String comment) {
    }

    /** 管理员跳转到任意办理节点。 */
    public record JumpRequest(@NotBlank String targetNodeId, String comment) {
    }

    /** 通用带意见请求（终止 / 催办）。 */
    public record CommentRequest(String comment) {
    }

    /** 追加节点：实例级动态加处理人（不改定义）。 */
    public record AppendNodeRequest(@NotBlank String afterNodeId, String name,
                                    List<OrgRef> assignees, String multiMode) {
    }

    /** 离职交接：批量转办某人全部在途任务。 */
    public record HandoverRequest(Long fromUserId, Long toUserId, String comment) {
    }

    /** 存草稿 / 修改草稿。 */
    public record DraftRequest(String defCode, Map<String, Object> formData, String title) {
    }

    /** 提交草稿（激活引擎）。 */
    public record SubmitDraftRequest(Map<String, Object> formData) {
    }

    /** 委托规则（代理预设）。 */
    public record DelegateRuleRequest(Long delegateToId, String defCode,
                                      String startDate, String endDate, Boolean enabled) {
    }
}
