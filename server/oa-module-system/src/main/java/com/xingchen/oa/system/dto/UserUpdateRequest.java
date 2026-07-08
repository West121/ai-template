package com.xingchen.oa.system.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDate;

/**
 * 更新用户档案（工号不可改；部门/岗位/角色走任职管理）。
 */
public record UserUpdateRequest(
        @NotBlank(message = "姓名不能为空") String name,
        String phone,
        String email,
        String gender,
        LocalDate birthday,
        LocalDate hireDate,
        String officeLocation,
        Long leaderId,
        String avatar,
        String remark
) {
}
