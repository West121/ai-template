package com.xingchen.oa.boot.ai.repository;

import com.xingchen.oa.boot.ai.entity.AiChatMessagePart;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface AiChatMessagePartRepository extends JpaRepository<AiChatMessagePart, Long> {

    List<AiChatMessagePart> findByMessageIdOrderBySequenceNoAsc(Long messageId);

    List<AiChatMessagePart> findByMessageIdInOrderByMessageIdAscSequenceNoAsc(Collection<Long> messageIds);

    void deleteByMessageIdIn(Collection<Long> messageIds);
}
