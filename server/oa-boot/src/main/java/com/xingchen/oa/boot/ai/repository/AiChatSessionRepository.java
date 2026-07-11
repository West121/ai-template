package com.xingchen.oa.boot.ai.repository;

import com.xingchen.oa.boot.ai.entity.AiChatSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.OffsetDateTime;
import java.util.List;

public interface AiChatSessionRepository extends JpaRepository<AiChatSession, Long> {

    List<AiChatSession> findByUserIdAndCreatedAtAfterOrderByUpdatedAtDesc(Long userId, OffsetDateTime after);
}
