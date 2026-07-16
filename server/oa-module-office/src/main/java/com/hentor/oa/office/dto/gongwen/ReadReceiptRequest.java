package com.hentor.oa.office.dto.gongwen;

/**
 * 传阅已阅回执（可带阅办意见）。
 */
public record ReadReceiptRequest(
        String opinion
) {
}
