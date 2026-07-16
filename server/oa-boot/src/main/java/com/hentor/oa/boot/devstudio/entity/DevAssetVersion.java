package com.hentor.oa.boot.devstudio.entity;

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
 * Dev Studio 统一资产快照（V49，docs/design/dev-studio.md §3.3 / 附录拍板 2）。
 *
 * <p>四类热资产（ORCH / PROCESS / FORM / BIZDOC_TPL）每次经统一门面
 * {@code /api/dev-studio/assets} 的保存/发布/回滚落一行；不侵入各资产引擎自身版本机制
 * （ORCH 原生 {@code orch_flow_version} 照旧并存）。{@code version_no} 是门面自增版本，
 * 亦是 PUT {@code baseVersion} 乐观锁的比对基准；(asset_type, code, version_no) 唯一索引兜并发。
 */
@Getter
@Setter
@Entity
@Table(name = "dev_asset_version")
public class DevAssetVersion {

    public static final String ACTOR_USER = "USER";
    public static final String ACTOR_AI = "AI";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "asset_type", nullable = false, length = 16)
    private String assetType;

    @Column(nullable = false, length = 64)
    private String code;

    @Column(name = "version_no", nullable = false)
    private Integer versionNo;

    @Column(columnDefinition = "text")
    private String content;

    /** USER=工作台人工；AI=批W2 dev_propose_change 确认执行。 */
    @Column(nullable = false, length = 8)
    private String actor = ACTOR_USER;

    @Column(name = "actor_id")
    private Long actorId;

    @Column(length = 255)
    private String summary;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
