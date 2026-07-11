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

/** AI 助手消息（role USER/ASSISTANT/TOOL；cards=卡片 JSON 兼容期保留；V2 批A 补 §14.2 列 + clientMessageId 幂等）。 */
@Getter
@Setter
@Entity
@Table(name = "ai_chat_message")
public class AiChatMessage {

    public static final String ROLE_USER = "USER";
    public static final String ROLE_ASSISTANT = "ASSISTANT";
    public static final String ROLE_TOOL = "TOOL";

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_STREAMING = "STREAMING";
    public static final String STATUS_COMPLETED = "COMPLETED";
    public static final String STATUS_FAILED = "FAILED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tenant_id", nullable = false, length = 32)
    private String tenantId = "default";

    /** 消息属主（=会话属主；配合 clientMessageId 组唯一约束）。 */
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "session_id", nullable = false)
    private Long sessionId;

    /** §15.1 前端幂等键：unique(tenant_id,user_id,client_message_id)，重试返回原消息不重复调模型。 */
    @Column(name = "client_message_id", length = 64)
    private String clientMessageId;

    /** 会话内序号（session.last_message_seq 派发）。 */
    @Column(name = "sequence_no")
    private Long sequenceNo;

    @Column(nullable = false, length = 16)
    private String role;

    /** §14.2 PENDING/STREAMING/COMPLETED/FAILED/CANCELLED。 */
    @Column(nullable = false, length = 16)
    private String status = STATUS_COMPLETED;

    @Column(columnDefinition = "text")
    private String content;

    /** Card[] JSON（§3 六类卡；兼容期与 parts 并存输出）。 */
    @Column(columnDefinition = "text")
    private String cards;

    /** 工具调用留痕 [{step,tool,args,result}]（审计）。 */
    @Column(name = "tool_calls", columnDefinition = "text")
    private String toolCalls;

    /** 附件 JSON [{fileId|dataUrl, kind:IMAGE|TEXT, name}]（§11 多模态，回显用；仅 USER 消息）。 */
    @Column(columnDefinition = "text")
    private String attachments;

    @Column(name = "input_tokens")
    private Integer inputTokens;

    @Column(name = "output_tokens")
    private Integer outputTokens;

    @Column(name = "request_id", length = 64)
    private String requestId;

    @Column(name = "trace_id", length = 64)
    private String traceId;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "completed_at")
    private OffsetDateTime completedAt;
}
