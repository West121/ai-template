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

import java.time.LocalDateTime;

/**
 * 传阅单：一份收文可传阅多人，已阅回执。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_doc_circulation")
public class DocCirculation {

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_READ = "READ";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "document_id", nullable = false)
    private Long documentId;

    @Column(name = "reader_id")
    private Long readerId;

    @Column(name = "reader_name", length = 64)
    private String readerName;

    @Column(nullable = false, length = 16)
    private String status;

    @Column(name = "read_at")
    private LocalDateTime readAt;

    @Column(length = 500)
    private String opinion;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
