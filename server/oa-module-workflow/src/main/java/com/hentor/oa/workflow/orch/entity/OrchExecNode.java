package com.hentor.oa.workflow.orch.entity;

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

/** 编排节点级留痕（input/output 截 8KB、耗时、错误、尝试次数）。 */
@Getter
@Setter
@Entity
@Table(name = "orch_exec_node")
public class OrchExecNode {

    public static final String STATUS_RUNNING = "RUNNING";
    public static final String STATUS_SUCCESS = "SUCCESS";
    public static final String STATUS_FAILED = "FAILED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "exec_id", nullable = false)
    private Long execId;

    @Column(name = "node_id", nullable = false, length = 64)
    private String nodeId;

    @Column(name = "node_name", length = 128)
    private String nodeName;

    @Column(nullable = false, length = 16)
    private String status;

    @Column(nullable = false)
    private Integer attempts = 1;

    @Column(columnDefinition = "text")
    private String input;

    @Column(columnDefinition = "text")
    private String output;

    @Column(columnDefinition = "text")
    private String error;

    @Column(name = "cost_ms")
    private Long costMs;

    @CreationTimestamp
    @Column(name = "started_at", updatable = false)
    private OffsetDateTime startedAt;
}
