package com.xingchen.oa.workflow.orch.entity;

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
 * 编排凭据：LLM（OpenAI-compatible 端点）/ HTTP_BEARER / HTTP_BASIC / HTTP_HEADER（通用出站认证）。
 * api_key 一律 AES-GCM 加密存储，接口不回显。
 */
@Getter
@Setter
@Entity
@Table(name = "orch_credential")
public class OrchCredential {

    public static final String TYPE_LLM = "LLM";
    public static final String TYPE_HTTP_BEARER = "HTTP_BEARER";
    public static final String TYPE_HTTP_BASIC = "HTTP_BASIC";
    public static final String TYPE_HTTP_HEADER = "HTTP_HEADER";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(nullable = false, length = 16)
    private String type = TYPE_LLM;

    @Column(name = "base_url", length = 255)
    private String baseUrl;

    @Column(name = "api_key_enc", columnDefinition = "text")
    private String apiKeyEnc;

    @Column(length = 64)
    private String model;

    /** HTTP_HEADER 型：自定义请求头名（如 X-Api-Key）。 */
    @Column(name = "header_name", length = 64)
    private String headerName;

    @Column(nullable = false)
    private Boolean enabled = true;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
