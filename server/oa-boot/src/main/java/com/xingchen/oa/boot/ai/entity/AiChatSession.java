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

/** AI 助手会话（用户隔离；V2 批A：tenant 预留 + status 串行化 + version 乐观锁，§14.1/§15）。 */
@Getter
@Setter
@Entity
@Table(name = "ai_chat_session")
public class AiChatSession {

    public static final String STATUS_IDLE = "IDLE";
    public static final String STATUS_RUNNING = "RUNNING";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 租户预留列（附1 裁定：常量 'default'，不做全局多租户）。 */
    @Column(name = "tenant_id", nullable = false, length = 32)
    private String tenantId = "default";

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 首问自动摘要（截 30 字）。 */
    @Column(length = 128)
    private String title;

    /** 滚动摘要：超窗时异步 LLM 压缩更早消息。 */
    @Column(columnDefinition = "text")
    private String summary;

    /** §15.2 会话串行化：IDLE / RUNNING（PG 原子更新获取，不用 Redis）。 */
    @Column(nullable = false, length = 16)
    private String status = STATUS_IDLE;

    /** 模型档案（批B 落真值）。 */
    @Column(name = "model_profile_id", length = 64)
    private String modelProfileId;

    @Column(name = "summary_version", nullable = false)
    private Integer summaryVersion = 0;

    /** §13.3 结构化滚动摘要游标：summary 已覆盖到此 message id（含）；MemoryAdvisor 只带 id &gt; 此值的近消息。 */
    @Column(name = "summarized_until_message_id")
    private Long summarizedUntilMessageId;

    /** §15.3 消息序号水位（会话内单调递增）。 */
    @Column(name = "last_message_seq", nullable = false)
    private Long lastMessageSeq = 0L;

    /** 乐观锁计数（acquire/release 原子更新自增；不用 @Version 以免与原子 UPDATE 冲突）。 */
    @Column(nullable = false)
    private Long version = 0L;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;
}
