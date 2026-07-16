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
 * 模型档案（ai-assistant-design-v2.md §4.3）：前端只选 {@code modelProfileId}（code），
 * 后端映射到 orch_credential 真实凭据——凭据/供应商/密钥不回传普通用户。
 */
@Getter
@Setter
@Entity
@Table(name = "ai_model_profile")
public class AiModelProfile {

    public static final String CODE_FAST = "FAST";
    public static final String CODE_STANDARD = "STANDARD";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 32, unique = true)
    private String code;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(length = 255)
    private String description;

    /** → orch_credential(LLM)；空 = 档案未配置（available=false）。 */
    @Column(name = "credential_id")
    private Long credentialId;

    /** 空 = 用凭据 model。 */
    @Column(name = "model_override", length = 128)
    private String modelOverride;

    @Column(nullable = false)
    private Boolean enabled = true;

    @Column(name = "sort_no", nullable = false)
    private Integer sortNo = 0;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
