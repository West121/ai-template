package com.hentor.oa.office.dto;

import java.time.LocalDateTime;

public record AnnouncementResponse(
        Long id,
        String category,
        String title,
        String content,
        String publisher,
        String deptName,
        Boolean top,
        Integer reads,
        LocalDateTime publishAt,
        Boolean readFlag
) {
}
