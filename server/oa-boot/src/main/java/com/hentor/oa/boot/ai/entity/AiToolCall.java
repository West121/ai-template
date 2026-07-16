package com.hentor.oa.boot.ai.entity;

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
 * 工具调用审计（ai-assistant-design-v2.md §14.4/§19.3 审计最小化）：
 * 名称 + 参数哈希/脱敏截断摘要 + 结果摘要 + 耗时 + risk（批A 占位 READ_ONLY，批B @AiToolDefinition 落真值）。
 * 敏感参数与完整业务结果不落全文。
 */
@Getter
@Setter
@Entity
@Table(name = "ai_tool_call")
public class AiToolCall {

    public static final String STATUS_SUCCEEDED = "SUCCEEDED";
    public static final String STATUS_FAILED = "FAILED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tenant_id", nullable = false, length = 32)
    private String tenantId = "default";

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "session_id")
    private Long sessionId;

    @Column(name = "message_id")
    private Long messageId;

    @Column(name = "tool_call_id", length = 64)
    private String toolCallId;

    @Column(name = "tool_name", nullable = false, length = 64)
    private String toolName;

    @Column(name = "risk_level", nullable = false, length = 32)
    private String riskLevel = "READ_ONLY";

    @Column(name = "arguments_hash", length = 64)
    private String argumentsHash;

    @Column(name = "arguments_summary", length = 512)
    private String argumentsSummary;

    @Column(name = "result_summary", length = 512)
    private String resultSummary;

    @Column(nullable = false, length = 16)
    private String status;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "request_id", length = 64)
    private String requestId;

    @Column(name = "trace_id", length = 64)
    private String traceId;

    @Column(name = "error_code", length = 64)
    private String errorCode;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "completed_at")
    private OffsetDateTime completedAt;
}
