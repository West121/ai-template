package com.xingchen.oa.system.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 个人中心·修改密码（改自己，仅需登录）。校验原密码 + 新密码（≥6、≠原密码）在 service 内做。
 */
public record ChangePasswordRequest(
        @NotBlank(message = "原密码不能为空") String oldPassword,
        @NotBlank(message = "新密码不能为空") String newPassword) {
}
