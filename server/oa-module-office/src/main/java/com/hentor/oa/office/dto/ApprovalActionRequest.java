package com.hentor.oa.office.dto;

/**
 * 审批处理请求体：approve 用 comment（可空）；reject 用 reason（必填，服务层校验）。
 */
public record ApprovalActionRequest(
        String comment,
        String reason
) {
}
