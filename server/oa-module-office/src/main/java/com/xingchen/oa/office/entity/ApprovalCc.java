package com.xingchen.oa.office.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 审批抄送。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_approval_cc")
public class ApprovalCc {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "approval_id", nullable = false)
    private Long approvalId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "read_flag", nullable = false)
    private Boolean readFlag = false;
}
