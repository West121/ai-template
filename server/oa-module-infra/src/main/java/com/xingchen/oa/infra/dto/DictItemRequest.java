package com.xingchen.oa.infra.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record DictItemRequest(
        @NotNull(message = "typeId 不能为空") Long typeId,
        Long parentId,
        @NotBlank(message = "标签不能为空") String label,
        @NotBlank(message = "值不能为空") String value,
        Integer sort,
        Boolean enabled,
        String remark) {
}
