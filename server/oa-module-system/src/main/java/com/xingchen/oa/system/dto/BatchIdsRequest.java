package com.xingchen.oa.system.dto;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * 批量操作通用请求体：目标 id 集合。用于 batch-delete 等仅需 ids 的批量接口。
 */
public record BatchIdsRequest(@NotEmpty(message = "ids 不能为空") List<Long> ids) {
}
