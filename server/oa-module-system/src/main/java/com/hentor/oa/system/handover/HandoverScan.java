package com.hentor.oa.system.handover;

/**
 * 扫描出的一条待交接项（provider.scan 返回）。HandoverService 据此建 sys_handover_item 行。
 *
 * @param refType  被交接对象类型（TASK / DEPT / …）
 * @param refId    被交接对象 id（字符串，兼容 Flowable taskId 等非数字 id）
 * @param oldValue 交接前状态 JSON（留痕）
 * @param note     人可读摘要（前端向导展示）
 */
public record HandoverScan(String refType, String refId, String oldValue, String note) {
}
