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

import java.time.LocalDate;
import java.time.OffsetDateTime;

/**
 * 委托规则（代理预设）：owner 预设 delegateTo 为代理人，命中时任务创建自动给受托人挂 candidate，
 * 双方可见可办，任一办结即结束。def_code 为空表示适用全部流程。
 */
@Getter
@Setter
@Entity
@Table(name = "wf_delegate_rule")
public class WfDelegateRule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "owner_id", nullable = false)
    private Long ownerId;

    @Column(name = "delegate_to_id", nullable = false)
    private Long delegateToId;

    @Column(name = "def_code", length = 64)
    private String defCode;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "end_date")
    private LocalDate endDate;

    @Column(nullable = false)
    private Boolean enabled = true;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
