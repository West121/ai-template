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
 * 数据集（ai-assistant-design-v2.md §11.2）：大于卡片容量（20 行）的报表结果不进聊天消息，
 * 落数据集短期保存；访问再次校验归属（tenant+user），过期 410。批C inline 存 rows_json，
 * storage_ref 留外置存储扩展点。
 */
@Getter
@Setter
@Entity
@Table(name = "ai_dataset")
public class AiDataset {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tenant_id", nullable = false, length = 32)
    private String tenantId = "default";

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "session_id")
    private Long sessionId;

    @Column(name = "report_code", length = 64)
    private String reportCode;

    @Column(name = "query_hash", length = 64)
    private String queryHash;

    /** 列定义 [{key,label}]。 */
    @Column(name = "schema_json", columnDefinition = "text")
    private String schemaJson;

    @Column(name = "row_count", nullable = false)
    private Integer rowCount;

    @Column(name = "storage_ref", nullable = false, length = 32)
    private String storageRef = "inline";

    @Column(name = "rows_json", columnDefinition = "text")
    private String rowsJson;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
