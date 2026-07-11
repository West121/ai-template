package com.xingchen.oa.workflow.orch.entity;

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

/** 编排执行流水。 */
@Getter
@Setter
@Entity
@Table(name = "orch_exec")
public class OrchExec {

    public static final String STATUS_RUNNING = "RUNNING";
    public static final String STATUS_WAITING = "WAITING";  // wait 节点挂起，等 resume/超时
    public static final String STATUS_SUCCESS = "SUCCESS";
    public static final String STATUS_FAILED = "FAILED";
    public static final String STATUS_CANCELED = "CANCELED";

    public static final String KIND_MANUAL = "MANUAL";
    public static final String KIND_CRON = "CRON";
    public static final String KIND_EVENT = "EVENT";
    public static final String KIND_WEBHOOK = "WEBHOOK";
    public static final String KIND_RERUN = "RERUN";
    public static final String KIND_ERROR_FLOW = "ERROR_FLOW";
    public static final String KIND_SUB_FLOW = "SUB_FLOW";
    public static final String KIND_RESUME_FAIL = "RESUME_FAIL";  // 失败节点续跑（新 exec，parent_exec_id 指向失败父）

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "flow_id", nullable = false)
    private Long flowId;

    @Column(name = "flow_code", length = 64)
    private String flowCode;

    @Column(name = "trigger_kind", nullable = false, length = 16)
    private String triggerKind;

    @Column(columnDefinition = "text")
    private String payload;

    @Column(nullable = false, length = 16)
    private String status = STATUS_RUNNING;

    @Column(columnDefinition = "text")
    private String result;

    @Column(columnDefinition = "text")
    private String error;

    /** wait 挂起恢复令牌（免登录 resume 鉴权）。 */
    @Column(name = "resume_token", length = 64)
    private String resumeToken;

    /** 分段链当前段（0=主段；每次挂起恢复 +1）。 */
    @Column(name = "current_segment", nullable = false)
    private Integer currentSegment = 0;

    /** 失败续跑血缘：指向失败的父 exec。 */
    @Column(name = "parent_exec_id")
    private Long parentExecId;

    /** 完整上下文快照 JSON（不截断；节点留痕 8KB 截断仅用于展示）。 */
    @Column(name = "context_snapshot", columnDefinition = "text")
    private String contextSnapshot;

    @CreationTimestamp
    @Column(name = "started_at", updatable = false)
    private OffsetDateTime startedAt;

    @Column(name = "ended_at")
    private OffsetDateTime endedAt;
}
