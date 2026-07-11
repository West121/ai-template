package com.xingchen.oa.boot.ai.repository;

import com.xingchen.oa.boot.ai.entity.AiToolCall;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AiToolCallRepository extends JpaRepository<AiToolCall, Long> {

    long countBySessionId(Long sessionId);
}
