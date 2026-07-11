package com.xingchen.oa.boot.ai.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.OffsetDateTime;

/**
 * 功能目录（ai-assistant-design-v2.md §12.1）：回答"系统有什么功能"、判断可进入、产受控导航卡。
 * 种子自前端 menu.ts 手工整理（smoke 防漂移比对 route_code ⊆ menu.ts）。
 */
@Getter
@Setter
@Entity
@Table(name = "ai_feature_catalog")
public class AiFeatureCatalog {

    public static final String STATUS_PUBLISHED = "PUBLISHED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "feature_code", nullable = false, length = 64, unique = true)
    private String featureCode;

    @Column(name = "module_code", nullable = false, length = 32)
    private String moduleCode;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(length = 255)
    private String description;

    /** 前端路由 path（menu.ts 对齐；FeatureRouteRegistry 映射）。 */
    @Column(name = "route_code", nullable = false, length = 128)
    private String routeCode;

    /** 逗号分隔，全部满足才可见；空=登录可见。 */
    @Column(name = "required_authorities", length = 255)
    private String requiredAuthorities;

    @Column(name = "supported_actions", length = 255)
    private String supportedActions;

    @Column(name = "related_form_codes", length = 255)
    private String relatedFormCodes;

    @Column(name = "related_process_codes", length = 255)
    private String relatedProcessCodes;

    @Column(length = 255)
    private String keywords;

    @Column(name = "system_version", nullable = false, length = 16)
    private String systemVersion = "v1";

    @Column(nullable = false, length = 16)
    private String status = STATUS_PUBLISHED;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
