package com.hentor.oa.office.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * 单据实例（BizDoc §2）：状态机 DRAFT →（无流程）EFFECTIVE｜（有流程）APPROVING → EFFECTIVE/REJECTED；VOID。
 * 数据权限按 dept_id + creator_id 走既有 DataScope；乐观锁 @Version。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_bizdoc")
public class BizDoc {

    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_APPROVING = "APPROVING";
    public static final String STATUS_EFFECTIVE = "EFFECTIVE";
    public static final String STATUS_REJECTED = "REJECTED";
    public static final String STATUS_VOID = "VOID";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "def_id", nullable = false)
    private Long defId;

    @Column(name = "def_code", nullable = false, length = 64)
    private String defCode;

    /** 单号（占号幂等；作废不回收）。 */
    @Column(name = "doc_no", length = 64)
    private String docNo;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(name = "form_data", columnDefinition = "text")
    private String formData;

    @Column(nullable = false, length = 16)
    private String status = STATUS_DRAFT;

    @Column(name = "process_instance_id", length = 64)
    private String processInstanceId;

    @Column(name = "creator_id")
    private Long creatorId;

    @Column(name = "creator_name", length = 64)
    private String creatorName;

    @Column(name = "dept_id")
    private Long deptId;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;
}
