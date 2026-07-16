package com.hentor.oa.office.dto;

import com.hentor.oa.common.fieldperm.FieldPerm;
import com.hentor.oa.common.fieldperm.FieldPermEntity;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 审批单响应。P3 字段权限（V52）：@FieldPerm 标注的列为「可控固定列」——角色×功能
 * （feature=WORKFLOW_TASKS，与「我的审批」页同键——/approval/* 已重定向并入 /workflow/tasks）配 visible=false 时该列在响应中置 null（FieldPermMasker 出口脱敏）；
 * 清单与 DTO 同文件防漂移（附2 拍板），未标列不可控（天然白名单）。
 */
@FieldPermEntity(feature = "WORKFLOW_TASKS")
public record ApprovalResponse(
        Long id,
        String title,
        String type,
        String applicant,
        Long applicantId,
        String status,
        @FieldPerm(label = "事由") String reason,
        Long deptId,
        String deptName,
        @FieldPerm(label = "开始日期") LocalDate startDate,
        @FieldPerm(label = "结束日期") LocalDate endDate,
        LocalDateTime createdAt
) {
}
