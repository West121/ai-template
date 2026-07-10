package com.xingchen.oa.office.dto.gongwen;

import jakarta.validation.constraints.NotBlank;

/**
 * 收文登记（起 gw_recv 流程）。code=来文字号（可空），unit=来文单位。
 */
public record RecvRegisterRequest(
        @NotBlank(message = "标题不能为空") String title,
        String code,
        String unit,
        String docType,
        String secret,
        String urgency,
        String content,
        Boolean needCirculate
) {
}
