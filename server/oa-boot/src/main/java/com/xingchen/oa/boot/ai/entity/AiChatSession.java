package com.xingchen.oa.boot.ai.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/** AI 助手会话（用户隔离）。 */
@Getter
@Setter
@Entity
@Table(name = "ai_chat_session")
public class AiChatSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 首问自动摘要（截 30 字）。 */
    @Column(length = 128)
    private String title;

    /** 滚动摘要：超窗时异步 LLM 压缩更早消息。 */
    @Column(columnDefinition = "text")
    private String summary;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
