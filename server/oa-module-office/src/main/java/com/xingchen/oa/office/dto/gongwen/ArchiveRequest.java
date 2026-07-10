package com.xingchen.oa.office.dto.gongwen;

/**
 * 归档：办结后写卷宗号（archive_no 缺省按 {year}-{category}-{流水} 生成）。
 */
public record ArchiveRequest(
        String category
) {
}
