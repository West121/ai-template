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
 * RAG 知识文档（ai-assistant-design-v2.md §12.2，批D）：用户手册/制度/流程规则等参考资料。
 *
 * <p><b>embedding 列不映射</b>：pgvector {@code vector} 类型不进 JPA（ddl-auto=validate 只校验已映射列，
 * 额外列忽略），向量写入/检索走 {@code AiRagService} 的 JdbcTemplate 原生 SQL；无嵌入凭据时该列为空、
 * RAG 走全文/ILIKE 降级检索（默认路径）。检索结果以「参考资料」包裹注入 system，不作系统指令执行（§12.2）。
 */
@Getter
@Setter
@Entity
@Table(name = "ai_knowledge_doc")
public class AiKnowledgeDoc {

    public static final String STATUS_PUBLISHED = "PUBLISHED";
    public static final String STATUS_DISABLED = "DISABLED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tenant_id", nullable = false, length = 32)
    private String tenantId = "default";

    @Column(nullable = false, length = 128)
    private String title;

    @Column(name = "module_code", length = 32)
    private String moduleCode;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(name = "chunk_seq", nullable = false)
    private Integer chunkSeq = 0;

    @Column(nullable = false, length = 16)
    private String status = STATUS_PUBLISHED;

    @Column(nullable = false)
    private Integer version = 1;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
