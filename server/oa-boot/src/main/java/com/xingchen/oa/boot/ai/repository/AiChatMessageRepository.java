package com.xingchen.oa.boot.ai.repository;

import com.xingchen.oa.boot.ai.entity.AiChatMessage;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiChatMessageRepository extends JpaRepository<AiChatMessage, Long> {

    List<AiChatMessage> findBySessionIdOrderByIdDesc(Long sessionId, Pageable pageable);

    Page<AiChatMessage> findBySessionIdOrderByIdAsc(Long sessionId, Pageable pageable);

    long countBySessionId(Long sessionId);

    void deleteBySessionId(Long sessionId);

    List<AiChatMessage> findBySessionId(Long sessionId);

    /** §15.1 消息幂等：同 (tenant,user,clientMessageId) 重试返回原消息。 */
    Optional<AiChatMessage> findFirstByTenantIdAndUserIdAndClientMessageId(
            String tenantId, Long userId, String clientMessageId);

    /** 幂等重放：取该 USER 消息之后的第一条助手回复。 */
    Optional<AiChatMessage> findFirstBySessionIdAndIdGreaterThanAndRoleOrderByIdAsc(
            Long sessionId, Long afterId, String role);
}
