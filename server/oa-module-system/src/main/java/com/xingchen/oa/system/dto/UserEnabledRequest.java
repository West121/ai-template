package com.xingchen.oa.system.dto;

import jakarta.validation.constraints.NotNull;

public record UserEnabledRequest(
        @NotNull(message = "enabled 不能为空") Boolean enabled
) {
}
