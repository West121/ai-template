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

import java.time.OffsetDateTime;

/**
 * 加签串行链：把单个任务沿链依次流转（不复用节点多实例，避免 ANY 或签退化）。
 * PRE 链=[被加签人..., 原审批人]；POST 链=[原审批人, 被加签人...]。
 */
@Getter
@Setter
@Entity
@Table(name = "wf_add_sign")
public class WfAddSign {

    public static final String MODE_PRE = "PRE";
    public static final String MODE_POST = "POST";
    public static final String STATUS_RUNNING = "RUNNING";
    public static final String STATUS_DONE = "DONE";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "task_id", nullable = false, length = 64)
    private String taskId;

    @Column(name = "proc_inst_id", nullable = false, length = 64)
    private String procInstId;

    @Column(name = "node_id", length = 64)
    private String nodeId;

    @Column(name = "origin_user_id", nullable = false)
    private Long originUserId;

    @Column(nullable = false, length = 8)
    private String mode;

    @Column(name = "chain_json", nullable = false, columnDefinition = "text")
    private String chainJson;

    @Column(nullable = false)
    private Integer pos = 0;

    @Column(nullable = false, length = 16)
    private String status = STATUS_RUNNING;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
