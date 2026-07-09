package com.xingchen.oa.workflow.entity;

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

@Getter
@Setter
@Entity
@Table(name = "wf_form_def")
public class WfFormDef {

    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_PUBLISHED = "PUBLISHED";
    public static final String STATUS_DISABLED = "DISABLED";

    /** 表单来源：ONLINE=在线设计器(存 schemaJson)；CODE=手写 react-hook-form 表单(仅存字段清单)。 */
    public static final String TYPE_ONLINE = "ONLINE";
    public static final String TYPE_CODE = "CODE";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String code;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(nullable = false)
    private Integer version = 1;

    /** ONLINE 表单存前端设计器 widgets JSON；CODE 表单可为 null（改由 fieldManifest 承载）。 */
    @Column(name = "schema_json", columnDefinition = "text")
    private String schemaJson;

    /** 表单来源类型（ONLINE/CODE），默认 ONLINE。 */
    @Column(name = "form_type", nullable = false, length = 20)
    private String formType = TYPE_ONLINE;

    /** CODE 表单的字段清单 JSON（FieldDescriptor[] 数组）；ONLINE 表单为 null（清单由 schemaJson 派生）。 */
    @Column(name = "field_manifest", columnDefinition = "text")
    private String fieldManifest;

    @Column(nullable = false, length = 20)
    private String status = STATUS_DRAFT;

    @Column(length = 255)
    private String remark;

    @Column(name = "created_by")
    private Long createdBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
