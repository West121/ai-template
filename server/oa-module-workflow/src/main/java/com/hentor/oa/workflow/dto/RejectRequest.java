package com.hentor.oa.workflow.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 驳回请求。
 * target=PREV（上一步）| START（退回发起人）| NODE（任意指定节点，需 targetNodeId）。
 * resumeStrategy=CONTINUE（重审后回驳回点续走）| BACK（重走中间路径，默认）。
 */
public record RejectRequest(
        @NotBlank String comment,
        String target,
        String targetNodeId,
        String resumeStrategy) {
}
