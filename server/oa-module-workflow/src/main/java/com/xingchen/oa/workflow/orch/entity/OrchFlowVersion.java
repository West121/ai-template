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

/** 编排发布版本快照（§9.5）：publish 即落一行，支持列表/查看/回滚。 */
@Getter
@Setter
@Entity
@Table(name = "orch_flow_version")
public class OrchFlowVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "flow_id", nullable = false)
    private Long flowId;

    @Column(nullable = false)
    private Integer version;

    @Column(length = 128)
    private String name;

    @Column(name = "designer_json", columnDefinition = "text")
    private String designerJson;

    @Column(name = "el_expr", columnDefinition = "text")
    private String elExpr;

    @Column(name = "trigger_type", length = 16)
    private String triggerType;

    @Column(name = "trigger_config", columnDefinition = "text")
    private String triggerConfig;

    @Column(length = 255)
    private String remark;

    @Column(name = "created_by")
    private Long createdBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
