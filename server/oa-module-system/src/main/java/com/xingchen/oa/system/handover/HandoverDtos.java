package com.xingchen.oa.system.handover;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 离职/交接（DP2）请求/响应 DTO 集合。
 */
public final class HandoverDtos {

    private HandoverDtos() {
    }

    /** 离职触发：{successorId, reason, resignDate}。 */
    public record ResignRequest(Long successorId, String reason, LocalDate resignDate) {
    }

    /** 逐项调整：改继任者 / 跳过（status=SKIPPED）。 */
    public record ItemUpdateRequest(Long successorId, String status) {
    }

    public record ItemView(Long id, String itemType, String refType, String refId,
                           String oldValue, String newValue, String status, Long successorId, String note) {
    }

    public record HandoverView(Long id, Long fromUserId, String fromUserName, Long toUserId, String toUserName,
                               String type, String reason, String status,
                               LocalDateTime createdAt, LocalDateTime completedAt, List<ItemView> items) {
    }

    public record FailedItem(Long itemId, String reason) {
    }

    /** 批量执行结果（item 级；failed 项保持 PENDING 可重试）。 */
    public record ExecResult(List<Long> doneIds, List<FailedItem> failed) {
    }
}
