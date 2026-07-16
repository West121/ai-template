package com.hentor.oa.boot.ai.service;

import com.hentor.oa.boot.ai.repository.AiActionDraftRepository;
import com.hentor.oa.boot.ai.repository.AiChatSessionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;

/**
 * AI 助手启动恢复（批A 契约）：
 * <ul>
 *   <li>动作草稿过期扫描：PENDING_CONFIRM 且 expires_at 已过 → EXPIRED（配合确认时懒标记双保险）；</li>
 *   <li>会话串行锁复位：进程崩溃遗留的 RUNNING → IDLE（附2：不留死锁会话）。</li>
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiStartupRecovery implements ApplicationRunner {

    private final AiActionDraftRepository draftRepository;
    private final AiChatSessionRepository sessionRepository;

    @Override
    public void run(ApplicationArguments args) {
        try {
            int expired = draftRepository.expireOverdue(OffsetDateTime.now());
            int reset = sessionRepository.resetRunningAll();
            log.info("AI 启动恢复：过期动作草稿 {} 条 → EXPIRED，遗留 RUNNING 会话 {} 条 → IDLE", expired, reset);
        } catch (Exception e) {
            log.warn("AI 启动恢复失败（不阻断启动）: {}", e.getMessage());
        }
    }
}
