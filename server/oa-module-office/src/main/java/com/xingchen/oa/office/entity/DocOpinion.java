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
 * 办文意见：办文单全过程留痕（GB/T 处理签电子化）。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_doc_opinion")
public class DocOpinion {

    public static final String DECISION_APPROVE = "APPROVE";
    public static final String DECISION_REJECT = "REJECT";
    public static final String DECISION_TRANSFER = "TRANSFER";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "document_id", nullable = false)
    private Long documentId;

    @Column(name = "task_key", length = 32)
    private String taskKey;

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "user_name", length = 64)
    private String userName;

    @Column(length = 1000)
    private String opinion;

    @Column(length = 16)
    private String decision;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
