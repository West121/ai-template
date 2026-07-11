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

/**
 * 消息 Part（ai-assistant-design-v2.md §9.3/§14.3）：助手响应结构化分片。
 * partType：{@code text} + 现有六类卡映射（navigate/form/confirm/list/chart/link）+ error。
 * 兼容期消息行 cards 字段并存输出，前端逐步切 parts 渲染。
 */
@Getter
@Setter
@Entity
@Table(name = "ai_chat_message_part")
public class AiChatMessagePart {

    public static final String TYPE_TEXT = "text";
    public static final String TYPE_ERROR = "error";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "message_id", nullable = false)
    private Long messageId;

    @Column(name = "part_type", nullable = false, length = 32)
    private String partType;

    @Column(name = "schema_version", nullable = false)
    private Integer schemaVersion = 1;

    @Column(name = "payload_json", nullable = false, columnDefinition = "text")
    private String payloadJson;

    @Column(name = "sequence_no", nullable = false)
    private Integer sequenceNo;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
