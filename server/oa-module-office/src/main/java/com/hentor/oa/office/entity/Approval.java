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

import java.time.LocalDate;
import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@Table(name = "oa_approval")
public class Approval {

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_APPROVED = "APPROVED";
    public static final String STATUS_REJECTED = "REJECTED";
    public static final String STATUS_WITHDRAWN = "WITHDRAWN";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 128)
    private String title;

    @Column(nullable = false, length = 32)
    private String type;

    @Column(nullable = false, length = 64)
    private String applicant;

    @Column(nullable = false, length = 32)
    private String status = STATUS_PENDING;

    @Column(length = 512)
    private String reason;

    /**
     * 单据归属部门（数据权限过滤维度）。
     */
    @Column(name = "dept_id")
    private Long deptId;

    /**
     * 申请人用户 id（SELF 数据范围过滤维度）。
     */
    @Column(name = "applicant_id")
    private Long applicantId;

    /**
     * 成本中心 id（DP1 多维数据权限 costCenter 维度过滤列，可空=不参与该维过滤）。
     */
    @Column(name = "cost_center_id")
    private Long costCenterId;

    /**
     * 项目 id（DP1 多维数据权限 project 维度过滤列，可空）。
     */
    @Column(name = "project_id")
    private Long projectId;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "end_date")
    private LocalDate endDate;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    /**
     * 乐观锁版本（B-07）：approve/reject/withdraw 并发写冲突时由此保证只有一个成功。
     */
    @Version
    @Column(nullable = false)
    private Long version;
}
