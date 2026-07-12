package com.xingchen.oa.system.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 转岗请求：变更主任职的部门/岗位/角色。retentionDays 覆盖全局旧部门数据保留天数（0=不保留，null=用全局默认）。
 */
public record TransferRequest(
        @NotNull(message = "部门不能为空") Long deptId,
        @NotNull(message = "岗位不能为空") Long postId,
        List<Long> roleIds,
        Integer retentionDays) {
}
