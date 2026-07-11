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

/** AI 助手消息（role USER/ASSISTANT/TOOL；cards=卡片 JSON；tool_calls=审计留痕）。 */
@Getter
@Setter
@Entity
@Table(name = "ai_chat_message")
public class AiChatMessage {

    public static final String ROLE_USER = "USER";
    public static final String ROLE_ASSISTANT = "ASSISTANT";
    public static final String ROLE_TOOL = "TOOL";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false)
    private Long sessionId;

    @Column(nullable = false, length = 16)
    private String role;

    @Column(columnDefinition = "text")
    private String content;

    /** Card[] JSON（§3 六类卡）。 */
    @Column(columnDefinition = "text")
    private String cards;

    /** 工具调用留痕 [{step,tool,args,result}]（审计）。 */
    @Column(name = "tool_calls", columnDefinition = "text")
    private String toolCalls;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
