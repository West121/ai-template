package com.xingchen.oa.system.dto;

import jakarta.validation.constraints.NotBlank;

public record PostRequest(
        @NotBlank(message = "岗位编码不能为空") String code,
        @NotBlank(message = "岗位名称不能为空") String name,
        Integer sort
) {
}
