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
 * 编排定义（自动化逻辑编排，契约 docs/design/orchestration-design.md §2/§3）。
 * designer_json=OrchModel 图 JSON；el_expr=发布时编译缓存的 LiteFlow EL。
 */
@Getter
@Setter
@Entity
@Table(name = "orch_flow")
public class OrchFlow {

    public static final String TRIGGER_MANUAL = "MANUAL";
    public static final String TRIGGER_CRON = "CRON";
    public static final String TRIGGER_EVENT = "EVENT";
    public static final String TRIGGER_WEBHOOK = "WEBHOOK";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String code;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(name = "designer_json", columnDefinition = "text")
    private String designerJson;

    @Column(name = "el_expr", columnDefinition = "text")
    private String elExpr;

    @Column(name = "trigger_type", length = 16)
    private String triggerType;

    @Column(name = "trigger_config", columnDefinition = "text")
    private String triggerConfig;

    @Column(name = "webhook_token", length = 64)
    private String webhookToken;

    @Column(nullable = false)
    private Boolean enabled = false;

    /** 已发布版本号（0=未发布；publish 即 +1 并重编译）。 */
    @Column(nullable = false)
    private Integer version = 0;

    /** 错误工作流：整流失败以 {error,failedNodeId,payload} 触发；错误流失败不级联。 */
    @Column(name = "error_flow_id")
    private Long errorFlowId;

    @Column(length = 255)
    private String remark;

    @Column(name = "created_by")
    private Long createdBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
