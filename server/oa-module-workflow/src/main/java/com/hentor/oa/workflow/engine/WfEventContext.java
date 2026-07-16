package com.hentor.oa.workflow.engine;

import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.task.service.delegate.DelegateTask;
import tools.jackson.databind.JsonNode;

import java.util.HashMap;
import java.util.Map;

/**
 * 自定义监听器（{@link WfEventHandler}）事件上下文：封装一次事件触发的运行时信息。
 *
 * <ul>
 *   <li>{@link #trigger} —— 触发点（6 种节点触发 + PROCESS_START/PROCESS_END）。</li>
 *   <li>{@link #vars} —— 流程变量读写视图（可变 Map）；handler 对其增改由 {@code wfEventDelegate}
 *       回写为流程变量，影响后续网关路由/表单。</li>
 *   <li>{@link #form} —— 表单数据快照的可变副本。</li>
 *   <li>{@link #execution} —— 当前 Flowable 执行体，<b>流程事件</b>非空、<b>节点事件</b>（taskListener）为 null。</li>
 *   <li>{@link #task} —— 当前 Flowable 任务，<b>节点事件</b>非空、<b>流程事件</b>为 null。</li>
 *   <li>{@link #procInstId}/{@link #nodeId}/{@link #title} —— 实例 id / 节点键（流程事件为 {@code "PROCESS"}）/ 实例标题。</li>
 *   <li>{@link #blocking} —— 本次是否为阻断触发（前置类 + 配置 blocking=true）。</li>
 *   <li>{@link #config} —— 原始事件配置 JSON（含 {@code delegate.bean} 及任意自定义字段，供 handler 读参数）。</li>
 * </ul>
 */
public class WfEventContext {

    private final String trigger;
    private final String action;
    private final String procInstId;
    private final String nodeId;
    private final String title;
    private final boolean blocking;
    private final Map<String, Object> vars;
    private final Map<String, Object> form;
    private final DelegateExecution execution;
    private final DelegateTask task;
    private final JsonNode config;

    public WfEventContext(String trigger, String action, String procInstId, String nodeId, String title,
                          boolean blocking, Map<String, Object> vars, Map<String, Object> form,
                          DelegateExecution execution, DelegateTask task, JsonNode config) {
        this.trigger = trigger;
        this.action = action;
        this.procInstId = procInstId;
        this.nodeId = nodeId;
        this.title = title;
        this.blocking = blocking;
        this.vars = vars == null ? new HashMap<>() : vars;
        this.form = form == null ? new HashMap<>() : form;
        this.execution = execution;
        this.task = task;
        this.config = config;
    }

    public String getTrigger() {
        return trigger;
    }

    public String getAction() {
        return action;
    }

    public String getProcInstId() {
        return procInstId;
    }

    public String getNodeId() {
        return nodeId;
    }

    public String getTitle() {
        return title;
    }

    public boolean isBlocking() {
        return blocking;
    }

    public Map<String, Object> getVars() {
        return vars;
    }

    public Map<String, Object> getForm() {
        return form;
    }

    public DelegateExecution getExecution() {
        return execution;
    }

    public DelegateTask getTask() {
        return task;
    }

    public JsonNode getConfig() {
        return config;
    }
}
