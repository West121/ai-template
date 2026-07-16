package com.hentor.oa.system.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 批量启停请求体：{ids, enabled}。
 */
public record BatchStatusRequest(
        @NotEmpty(message = "ids 不能为空") List<Long> ids,
        @NotNull(message = "enabled 不能为空") Boolean enabled) {
}
