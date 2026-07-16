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
@Table(name = "wf_operation")
public class WfOperation {

    public static final String ACTION_SUBMIT = "SUBMIT";
    public static final String ACTION_APPROVE = "APPROVE";
    public static final String ACTION_REJECT = "REJECT";
    public static final String ACTION_CANCEL = "CANCEL";
    public static final String ACTION_RESUBMIT = "RESUBMIT";
    public static final String ACTION_CC = "CC";
    public static final String ACTION_ADD_SIGN = "ADD_SIGN";
    public static final String ACTION_COUNTER_SIGN = "COUNTER_SIGN";
    public static final String ACTION_REDUCE_SIGN = "REDUCE_SIGN";
    public static final String ACTION_TRANSFER = "TRANSFER";
    public static final String ACTION_DELEGATE = "DELEGATE";
    public static final String ACTION_RESOLVE = "RESOLVE";
    public static final String ACTION_RETRIEVE = "RETRIEVE";
    public static final String ACTION_JUMP = "JUMP";
    public static final String ACTION_TERMINATE = "TERMINATE";
    public static final String ACTION_URGE = "URGE";
    public static final String ACTION_ASSIST = "ASSIST";
    public static final String ACTION_ASSIST_REPLY = "ASSIST_REPLY";
    public static final String ACTION_COMMUNICATE = "COMMUNICATE";
    public static final String ACTION_CLAIM = "CLAIM";
    public static final String ACTION_UNCLAIM = "UNCLAIM";
    public static final String ACTION_APPEND_NODE = "APPEND_NODE";
    public static final String ACTION_HANDOVER = "HANDOVER";
    public static final String ACTION_READ = "READ";
    public static final String ACTION_VOTE_PASS = "VOTE_PASS";
    public static final String ACTION_VOTE_REJECT = "VOTE_REJECT";
    public static final String ACTION_RESURRECT = "RESURRECT";   // P3 唤醒
    public static final String ACTION_SEAL = "SEAL";             // P3 盖章
    public static final String ACTION_AI = "AI_APPROVE";         // P3 AI 审批
    public static final String ACTION_AUTO_APPROVE = "AUTO_APPROVE"; // 自动通过节点
    public static final String ACTION_AUTO_REJECT = "AUTO_REJECT";   // 自动拒绝节点

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "proc_inst_id", nullable = false, length = 64)
    private String procInstId;

    @Column(name = "task_id", length = 64)
    private String taskId;

    @Column(name = "node_id", length = 64)
    private String nodeId;

    @Column(name = "node_name", length = 128)
    private String nodeName;

    @Column(name = "actor_id")
    private Long actorId;

    @Column(name = "actor_name", length = 64)
    private String actorName;

    @Column(nullable = false, length = 32)
    private String action;

    @Column(name = "detail_json", columnDefinition = "text")
    private String detailJson;

    @Column(columnDefinition = "text")
    private String comment;

    /** 业务时间（穿越时空）：为空表示与真实时间一致，展示/报表优先取此列。 */
    @Column(name = "biz_time")
    private OffsetDateTime bizTime;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
