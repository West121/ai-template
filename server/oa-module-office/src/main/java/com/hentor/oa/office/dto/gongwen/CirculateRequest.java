package com.hentor.oa.office.dto.gongwen;

import java.util.List;

/**
 * 发起传阅：指定读者列表。
 */
public record CirculateRequest(
        List<Reader> readers
) {
    public record Reader(Long id, String name) {
    }
}
