package com.xingchen.oa.office.entity;

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
}
