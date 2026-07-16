package com.hentor.oa.boot.ai.repository;

import com.hentor.oa.boot.ai.entity.AiActionDraft;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;

public interface AiActionDraftRepository extends JpaRepository<AiActionDraft, Long> {

    /**
     * 原子认领（双击/并发确认防线）：仅 PENDING_CONFIRM 可 → CONFIRMED，同时落 idempotency_key。
     * 返回 0 = 已被其他确认请求认领/已终态。
     */
    @Modifying
    @Transactional
    @Query("update AiActionDraft d set d.status = 'CONFIRMED', d.confirmedAt = :now, d.updatedAt = :now, "
            + "d.idempotencyKey = :idemKey, d.version = d.version + 1 "
            + "where d.id = :id and d.status = 'PENDING_CONFIRM'")
    int claim(Long id, OffsetDateTime now, String idemKey);

    /** 启动扫描：过期未确认草稿批量标记 EXPIRED（§7.2 状态机旁路）。 */
    @Modifying
    @Transactional
    @Query("update AiActionDraft d set d.status = 'EXPIRED', d.updatedAt = :now "
            + "where d.status = 'PENDING_CONFIRM' and d.expiresAt < :now")
    int expireOverdue(OffsetDateTime now);
}
