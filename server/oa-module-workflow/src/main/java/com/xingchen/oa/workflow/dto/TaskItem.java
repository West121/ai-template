package com.xingchen.oa.workflow.dto;

import java.time.OffsetDateTime;

public record TaskItem(
        String taskId,
        String procInstId,
        String instanceTitle,
        String defName,
        String nodeName,
        String initiatorName,
        OffsetDateTime createdAt,
        boolean groupClaim,
        boolean delegated,
        // 自定义详情跳转路径：流程定义配 form_view_path 模板（{id}=businessKey 末段，如公文 documentId）时生成，
        // 如 /document/send/67；普通流程为 null（前端回退通用 wf 实例详情）。
        String viewPath) {
}
