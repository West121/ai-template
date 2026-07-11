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
 * 写操作动作草稿（ai-assistant-design-v2.md §7.2，PG 持久化替换内存暂存）。
 *
 * <p>状态机：{@code PENDING_CONFIRM → CONFIRMED → EXECUTING → SUCCEEDED|FAILED}，
 * 旁路 {@code CANCELLED}（用户取消）/{@code EXPIRED}（10min 过期，启动扫描 + 读时懒标记）。
 * TOCTOU（§7.4）：stage 时保存 target_id/target_version/expected_status/payload_hash，
 * 确认执行前重新比对——任务类动作校验 Flowable 任务仍存在且 assignee 未变，变了返回 AI_ACTION_STALE。
 */
@Getter
@Setter
@Entity
@Table(name = "ai_action_draft")
public class AiActionDraft {

    public static final String STATUS_PENDING_CONFIRM = "PENDING_CONFIRM";
    public static final String STATUS_CONFIRMED = "CONFIRMED";
    public static final String STATUS_EXECUTING = "EXECUTING";
    public static final String STATUS_SUCCEEDED = "SUCCEEDED";
    public static final String STATUS_FAILED = "FAILED";
    public static final String STATUS_CANCELLED = "CANCELLED";
    public static final String STATUS_EXPIRED = "EXPIRED";

    public static final String RISK_CONFIRM_REQUIRED = "CONFIRM_REQUIRED";

    public static final String TARGET_TASK = "task";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tenant_id", nullable = false, length = 32)
    private String tenantId = "default";

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "session_id")
    private Long sessionId;

    @Column(name = "source_message_id")
    private Long sourceMessageId;

    @Column(name = "tool_name", nullable = false, length = 64)
    private String toolName;

    @Column(name = "action_type", length = 64)
    private String actionType;

    @Column(name = "payload_json", nullable = false, columnDefinition = "text")
    private String payloadJson;

    /** SHA-256(payload_json)，确认时重算比对（§7.3-8 参数哈希未变化）。 */
    @Column(name = "payload_hash", nullable = false, length = 64)
    private String payloadHash;

    @Column(name = "target_type", length = 32)
    private String targetType;

    @Column(name = "target_id", length = 128)
    private String targetId;

    /** 任务类=stage 时 assignee 快照；确认时变更 → AI_ACTION_STALE。 */
    @Column(name = "target_version", length = 128)
    private String targetVersion;

    @Column(name = "expected_status", length = 32)
    private String expectedStatus;

    @Column(name = "risk_level", nullable = false, length = 32)
    private String riskLevel = RISK_CONFIRM_REQUIRED;

    @Column(nullable = false, length = 32)
    private String status = STATUS_PENDING_CONFIRM;

    /** 确认请求 Idempotency-Key：同键重复确认返回原执行结果（仅执行一次）。 */
    @Column(name = "idempotency_key", length = 128)
    private String idempotencyKey;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    @Column(name = "confirmed_at")
    private OffsetDateTime confirmedAt;

    @Column(name = "executed_at")
    private OffsetDateTime executedAt;

    /** 执行结果 JSON（幂等重放返回）。 */
    @Column(name = "result_ref", columnDefinition = "text")
    private String resultRef;

    @Column(name = "error_code", length = 64)
    private String errorCode;

    @Column(name = "error_message", columnDefinition = "text")
    private String errorMessage;

    @Column(nullable = false)
    private Long version = 0L;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
