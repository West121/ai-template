package com.hentor.oa.office.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 公文：收文（RECEIVE）/ 发文（SEND）。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_document")
public class Document {

    public static final String DIRECTION_RECEIVE = "RECEIVE";
    public static final String DIRECTION_SEND = "SEND";

    public static final String STATUS_TO_SIGN = "TO_SIGN";
    public static final String STATUS_PROCESSING = "PROCESSING";
    public static final String STATUS_FINISHED = "FINISHED";
    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_REVIEWING = "REVIEWING";
    public static final String STATUS_ISSUED = "ISSUED";
    public static final String STATUS_PUBLISHED = "PUBLISHED";
    // 发文高级流转：DRAFT → REVIEWING → ISSUED → SEALED → PUBLISHED → ARCHIVED（作废 VOIDED）
    public static final String STATUS_SEALED = "SEALED";
    public static final String STATUS_ARCHIVED = "ARCHIVED";
    public static final String STATUS_VOIDED = "VOIDED";
    // 收文高级流转：REGISTERED → ASSIGNING → APPROVING → HANDLING → CIRCULATING → FINISHED → ARCHIVED
    public static final String STATUS_REGISTERED = "REGISTERED";
    public static final String STATUS_ASSIGNING = "ASSIGNING";
    public static final String STATUS_APPROVING = "APPROVING";
    public static final String STATUS_HANDLING = "HANDLING";
    public static final String STATUS_CIRCULATING = "CIRCULATING";

    public static final String SEAL_NONE = "NONE";
    public static final String SEAL_PENDING = "PENDING";
    public static final String SEAL_SEALED = "SEALED";

    /** 文头类型：RED=红头正式公文（GB/T 红头三件套）/ PLAIN=白头普通文件。 */
    public static final String HEADER_RED = "RED";
    public static final String HEADER_PLAIN = "PLAIN";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 8)
    private String direction;

    @Column(nullable = false, length = 64)
    private String code;

    @Column(nullable = false, length = 200)
    private String title;

    /**
     * 来文单位（收文）/ 主送单位（发文）。
     */
    @Column(length = 128)
    private String unit;

    @Column(nullable = false, length = 16)
    private String secret;

    @Column(nullable = false, length = 16)
    private String urgency;

    @Column(nullable = false, length = 16)
    private String status;

    @Column(length = 64)
    private String drafter;

    @Column(length = 64)
    private String signer;

    @Column(columnDefinition = "text")
    private String content;

    @Column(name = "doc_date")
    private LocalDate docDate;

    @Column(name = "dept_id")
    private Long deptId;

    @Column(name = "creator_id")
    private Long creatorId;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    // ---------- V20 中国式公文高级化：GB/T 9704 版式项 + 流转态 ----------

    /** 份号（涉密公文，6 位）。 */
    @Column(name = "copy_no", length = 16)
    private String copyNo;

    /** 签发人（上行文标此项，居右）。 */
    @Column(length = 64)
    private String issuer;

    /** 发文机关标志（红头文字，如「涵韬科技有限公司文件」）。 */
    @Column(name = "issuing_org", length = 128)
    private String issuingOrg;

    /** 文种：决定/通知/通报/报告/请示/批复/意见/函/纪要… */
    @Column(name = "doc_type", length = 16)
    private String docType;

    /** 文头类型：RED 红头 / PLAIN 白头普通文件（null 按 RED 处理）。 */
    @Column(name = "header_type", length = 16)
    private String headerType;

    /** 主送机关（多个以「；」分隔）。 */
    @Column(name = "main_recipients", columnDefinition = "text")
    private String mainRecipients;

    /** 抄送机关。 */
    @Column(name = "cc_recipients", columnDefinition = "text")
    private String ccRecipients;

    /** 附件说明/文件 id 列表（JSON）。 */
    @Column(columnDefinition = "text")
    private String attachments;

    /** 附注（如「此件公开发布」）。 */
    @Column(length = 255)
    private String annotation;

    /** 引用的红头/正文套版模板 id。 */
    @Column(name = "template_id")
    private Long templateId;

    /** 用印状态：NONE/PENDING/SEALED。 */
    @Column(name = "seal_status", length = 16)
    private String sealStatus;

    @Column(name = "sealed_by", length = 64)
    private String sealedBy;

    @Column(name = "sealed_at")
    private LocalDateTime sealedAt;

    /** 关联 Flowable 流程实例 id。 */
    @Column(name = "process_instance_id", length = 64)
    private String processInstanceId;

    @Column
    private Boolean archived;

    @Column(name = "archive_no", length = 64)
    private String archiveNo;

    @Column(name = "archived_at")
    private LocalDateTime archivedAt;

    /** 密级期限（涉密解密日期）。 */
    @Column(name = "secret_expire")
    private LocalDate secretExpire;
}
