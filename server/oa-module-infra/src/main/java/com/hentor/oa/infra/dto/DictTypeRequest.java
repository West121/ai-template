package com.hentor.oa.infra.dto;

import jakarta.validation.constraints.NotBlank;

public record DictTypeRequest(
        @NotBlank(message = "字典编码不能为空") String code,
        @NotBlank(message = "字典名称不能为空") String name,
        String remark,
        Boolean enabled) {
}
