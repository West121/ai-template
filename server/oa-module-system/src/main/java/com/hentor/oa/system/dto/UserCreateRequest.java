package com.hentor.oa.system.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.List;

/**
 * 创建用户：同时建立主任职（deptId + postId + roleIds）。
 * empNo 缺省时后端自动生成（XC + 4 位递增）。
 */
public record UserCreateRequest(
        @NotBlank(message = "用户名不能为空") String username,
        @NotBlank(message = "姓名不能为空") String name,
        String phone,
        @NotBlank(message = "密码不能为空") String password,
        @NotNull(message = "部门不能为空") Long deptId,
        @NotNull(message = "岗位不能为空") Long postId,
        List<Long> roleIds,
        String empNo,
        String email,
        String gender,
        LocalDate birthday,
        LocalDate hireDate,
        String officeLocation,
        Long leaderId,
        String avatar,
        String remark,
        /** 指定直属上级 id（多值、有序）；缺省=不配（LEADER 节点回退部门负责人）。 */
        List<Long> leaderIds
) {
}
