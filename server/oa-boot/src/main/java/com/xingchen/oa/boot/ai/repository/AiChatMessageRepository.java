package com.xingchen.oa.boot.ai.repository;

import com.xingchen.oa.boot.ai.entity.AiChatMessage;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AiChatMessageRepository extends JpaRepository<AiChatMessage, Long> {

    List<AiChatMessage> findBySessionIdOrderByIdDesc(Long sessionId, Pageable pageable);

    Page<AiChatMessage> findBySessionIdOrderByIdAsc(Long sessionId, Pageable pageable);

    long countBySessionId(Long sessionId);

    void deleteBySessionId(Long sessionId);
}
