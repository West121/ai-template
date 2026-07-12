package com.xingchen.oa.office.knowledge.entity;

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
 * 知识空间（ai-knowledge-base.md §2 kb_space）。
 * visibility 决定可见范围：PUBLIC 全员可见 / INTERNAL 登录可见 / PRIVATE 仅成员（§5 红线）。
 */
@Getter
@Setter
@Entity
@Table(name = "kb_space")
public class KbSpace {

    public static final String VIS_PUBLIC = "PUBLIC";
    public static final String VIS_INTERNAL = "INTERNAL";
    public static final String VIS_PRIVATE = "PRIVATE";

    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_ARCHIVED = "ARCHIVED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tenant_id", nullable = false, length = 32)
    private String tenantId = "default";

    @Column(nullable = false, length = 128)
    private String name;

    @Column(nullable = false, unique = true, length = 64)
    private String code;

    @Column(length = 500)
    private String description;

    @Column(length = 64)
    private String icon;

    @Column(nullable = false, length = 16)
    private String visibility = VIS_INTERNAL;

    @Column(name = "owner_id")
    private Long ownerId;

    @Column(nullable = false)
    private Integer sort = 0;

    @Column(nullable = false, length = 16)
    private String status = STATUS_ACTIVE;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
