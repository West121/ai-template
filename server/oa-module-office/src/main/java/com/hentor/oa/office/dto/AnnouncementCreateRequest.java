package com.hentor.oa.office.dto;

import jakarta.validation.constraints.NotBlank;

public record AnnouncementCreateRequest(
        @NotBlank(message = "公告分类不能为空") String category,
        @NotBlank(message = "公告标题不能为空") String title,
        @NotBlank(message = "公告内容不能为空") String content,
        Boolean top
) {
}
