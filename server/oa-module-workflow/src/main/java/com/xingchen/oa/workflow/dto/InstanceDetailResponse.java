package com.xingchen.oa.workflow.dto;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

/** 实例详情：表单快照 + 当前节点 + 时间线 + 图高亮 + 权限标记 + P2 操作元数据 + P3 高级能力。 */
public record InstanceDetailResponse(
        Long id,
        String procInstId,
        String defCode,
        String defName,
        String title,
        String bizStatus,
        Long initiatorId,
        String initiatorName,
        OffsetDateTime createdAt,
        OffsetDateTime endedAt,
        String formSchema,
        Object formData,
        List<CurrentNode> currentNodes,
        List<TimelineItem> timeline,
        Highlight highlight,
        String bpmnXml,
        boolean canCancel,
        String myTaskId,
        // P2 扩展
        List<String> allowedOps,
        boolean isAdmin,
        List<JumpTarget> jumpTargets,
        List<CommentItem> comments,
        boolean readByMe,
        List<Handler> currentHandlers,
        // P3 扩展
        List<SubInstance> subInstances,
        boolean predictable,
        boolean resurrectable,
        List<SealUse> seals,
        String bizTime,
        Map<String, String> nodeFormPerms,
        // P1-C 自定义表单：CUSTOM 时前端改用 formViewPath 路由/内嵌，DYNAMIC 走表单快照
        String formType,
        String formViewPath,
        // P2 办理选项/审核菜单透传（当前节点）：前端据此渲染候选/历史优先/自动跳过标记 + JUMP/RETURN 按钮
        Map<String, Object> nodeHandleOptions,
        Object auditMenu,
        // 跟踪图按设计器类型渲染：DINGTALK→钉钉跟踪图(用 designerJson)，BPMN→bpmn 图(用 bpmnXml)。
        // highlight.completed/active 的节点 id 两设计器通用（转换器从钉钉 JSON 生成 BPMN 时保留节点 id）。
        String designerType,
        Object designerJson) {

    public record AssigneeInfo(String userId, String name, String status) {
    }

    public record CurrentNode(String nodeId, String nodeName, List<AssigneeInfo> assignees) {
    }

    public record TimelineItem(String nodeId, String nodeName, String actorName, String action,
                               String comment, OffsetDateTime createdAt) {
    }

    public record Highlight(List<String> completed, List<String> active) {
    }

    /** 可跳转/驳回目标办理节点。 */
    public record JumpTarget(String nodeId, String name) {
    }

    /** 沟通线程留言项。 */
    public record CommentItem(String taskId, String fromName, String content, OffsetDateTime createdAt) {
    }

    /** 本节点其他待办处理人（供减签勾选）。 */
    public record Handler(Long userId, String name, String taskId) {
    }

    /** 子流程入口（P3）：主流程 CallActivity 节点触发的子流程实例。 */
    public record SubInstance(String nodeId, String subInstanceId, String title, String bizStatus) {
    }

    /** 已用电子章（P3）：节点盖章记录。 */
    public record SealUse(String nodeName, String sealImageUrl, String userName, OffsetDateTime time) {
    }
}
