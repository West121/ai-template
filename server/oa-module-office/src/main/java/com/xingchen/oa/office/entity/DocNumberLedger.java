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

import java.time.LocalDateTime;

/**
 * 文号台账/登记簿：每次正式占号落一行；作废只改 status 不回收号（台账连续可查）。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_doc_number_ledger")
public class DocNumberLedger {

    public static final String STATUS_OCCUPIED = "OCCUPIED";
    public static final String STATUS_VOID = "VOID";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "doc_number", nullable = false, length = 64)
    private String docNumber;

    @Column(name = "rule_id")
    private Long ruleId;

    @Column(name = "document_id")
    private Long documentId;

    @Column(name = "doc_title", length = 200)
    private String docTitle;

    @CreationTimestamp
    @Column(name = "issued_at", updatable = false)
    private LocalDateTime issuedAt;

    @Column(length = 64)
    private String issuer;

    @Column(nullable = false, length = 16)
    private String status;
}
