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
 * 长期偏好记忆（ai-assistant-design-v2.md §13.4，批D）：用户显式「记住」或系统推断的稳定偏好，
 * 与业务实时状态严格区分（业务事实必须实时 Tool 查询，不从记忆回答）。用户可查看/删除（软删）。
 * 敏感黑名单（密码/token/身份证/工资/银行卡）在应用层拒存，不落库。
 */
@Getter
@Setter
@Entity
@Table(name = "ai_user_memory")
public class AiUserMemory {

    public static final String TYPE_EXPLICIT = "EXPLICIT";
    public static final String TYPE_INFERRED = "INFERRED";
    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_DELETED = "DELETED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tenant_id", nullable = false, length = 32)
    private String tenantId = "default";

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "memory_type", nullable = false, length = 16)
    private String memoryType = TYPE_EXPLICIT;

    @Column(name = "memory_key", nullable = false, length = 128)
    private String memoryKey;

    @Column(name = "memory_value", nullable = false, columnDefinition = "text")
    private String memoryValue;

    @Column(nullable = false)
    private Double confidence = 1.0;

    @Column(name = "source_message_id")
    private Long sourceMessageId;

    @Column(name = "expires_at")
    private OffsetDateTime expiresAt;

    @Column(nullable = false, length = 16)
    private String status = STATUS_ACTIVE;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
