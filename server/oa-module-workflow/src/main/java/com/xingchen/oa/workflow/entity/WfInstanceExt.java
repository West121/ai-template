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
@Table(name = "wf_instance_ext")
public class WfInstanceExt {

    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_RUNNING = "RUNNING";
    public static final String STATUS_APPROVED = "APPROVED";
    public static final String STATUS_REJECTED = "REJECTED";
    public static final String STATUS_CANCELED = "CANCELED";
    public static final String STATUS_TERMINATED = "TERMINATED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "proc_inst_id", nullable = false, unique = true, length = 64)
    private String procInstId;

    @Column(name = "def_code", nullable = false, length = 64)
    private String defCode;

    @Column(name = "def_name", length = 128)
    private String defName;

    @Column(nullable = false, length = 255)
    private String title;

    @Column(name = "initiator_id")
    private Long initiatorId;

    @Column(name = "initiator_name", length = 64)
    private String initiatorName;

    @Column(name = "initiator_dept_id")
    private Long initiatorDeptId;

    @Column(name = "form_code", length = 64)
    private String formCode;

    @Column(name = "form_version")
    private Integer formVersion;

    @Column(name = "form_schema_snapshot", columnDefinition = "text")
    private String formSchemaSnapshot;

    @Column(name = "form_data_json", columnDefinition = "text")
    private String formDataJson;

    @Column(name = "biz_status", nullable = false, length = 20)
    private String bizStatus = STATUS_RUNNING;

    /** 穿越时空业务时间（补审指定日期）；展示/报表用，引擎真实时间不动。 */
    @Column(name = "biz_time")
    private OffsetDateTime bizTime;

    /** 唤醒来源：被唤醒重建时记录原（已结束）实例的 proc_inst_id。 */
    @Column(name = "resurrect_from", length = 64)
    private String resurrectFrom;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "ended_at")
    private OffsetDateTime endedAt;
}
