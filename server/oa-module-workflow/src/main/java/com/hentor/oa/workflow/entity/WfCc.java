package com.hentor.oa.workflow.entity;

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
@Table(name = "wf_cc")
public class WfCc {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "proc_inst_id", nullable = false, length = 64)
    private String procInstId;

    @Column(name = "node_id", length = 64)
    private String nodeId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "read_flag", nullable = false)
    private Boolean readFlag = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
