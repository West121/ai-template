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

/**
 * Tier 2 脚本执行审计（{@code wf_script_exec_log}，V18）。
 *
 * <p>治理红线（{@code docs/design/next-gen-workflow-and-formula.md} §3.3 第 3 条）：后端脚本以应用完整权限运行、
 * 可有副作用，因此<b>每一次</b>脚本执行（流程 scriptTask 运行时 + 编辑器测试运行）都落一条审计：
 * who（{@link #actorId}/{@link #actorName}）、哪段脚本（{@link #scriptRef}）、语言（{@link #lang}）、
 * 耗时（{@link #costMs}）、成功/失败（{@link #success}/{@link #errorMsg}）、时间（{@link #createdAt}）。
 */
@Getter
@Setter
@Entity
@Table(name = "wf_script_exec_log")
public class WfScriptExecLog {

    /** 来源：流程节点运行时 */
    public static final String SOURCE_TASK = "TASK";
    /** 来源：编辑器测试运行 */
    public static final String SOURCE_TEST_RUN = "TEST_RUN";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 执行者用户 id（运行时可能为系统/异步执行器线程 → 空） */
    @Column(name = "actor_id")
    private Long actorId;

    /** 执行者名（空=系统） */
    @Column(name = "actor_name", length = 64)
    private String actorName;

    /** 脚本标识：scriptTask=&lt;procDefId&gt;#&lt;nodeId&gt;；测试运行=test-run */
    @Column(name = "script_ref", length = 255)
    private String scriptRef;

    /** 脚本语言：groovy / js / python */
    @Column(nullable = false, length = 16)
    private String lang;

    /** 来源：TASK / TEST_RUN */
    @Column(nullable = false, length = 20)
    private String source;

    /** 执行是否成功 */
    @Column(nullable = false)
    private Boolean success;

    /** 执行耗时（毫秒，含编译） */
    @Column(name = "cost_ms")
    private Long costMs;

    /** 失败原因（成功为空） */
    @Column(name = "error_msg", columnDefinition = "text")
    private String errorMsg;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
