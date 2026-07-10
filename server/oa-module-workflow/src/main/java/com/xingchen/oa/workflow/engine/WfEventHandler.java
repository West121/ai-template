package com.xingchen.oa.workflow.engine;

/**
 * 自定义监听器 SPI（节点/流程事件 {@code action=DELEGATE} 用）：把业务方自己的 Spring Bean 插进工作流事件分发。
 *
 * <p>实现类以 bean 名注册（如 {@code @Component("demoBudgetGuard")}），事件配置
 * {@code delegate:{bean:"demoBudgetGuard"}} 指向该名；运行时 {@code wfEventDelegate} 按名
 * {@code applicationContext.getBean(bean, WfEventHandler.class)} 取出并调 {@link #handle(WfEventContext)}。
 *
 * <p><b>阻断语义</b>：当事件 {@code blocking=true} 且触发点为前置类
 * （{@code TASK_BEFORE_COMPLETE}/{@code TASK_BEFORE_UNDO}/{@code PROCESS_START}）时，本 handler 抛出的异常
 * <b>原样上抛</b> → 经 Flowable 任务/执行监听器上抛 → completeTask/startProcessInstance 事务回滚 → 办理被打断，
 * approve/reject 端点返回该错误（{@link com.xingchen.oa.common.exception.BusinessException} 的 code/msg 直达前端）。
 * {@code blocking=false}（默认）时异常被 {@code safeDispatch} 兜底吞掉（fire-and-forget），不打断办理。
 *
 * <p><b>治理</b>：DELEGATE 与后端脚本同属<b>受信代码</b>（完整应用权限，非沙箱）。bean 查找本身受控——只允许调用
 * 已注册的 Spring bean，前端配置入口 gate {@code wf:script:write}。
 */
public interface WfEventHandler {

    /**
     * 处理一次事件。可读写 {@link WfEventContext#getVars()}（增改经 {@code wfEventDelegate} 回写为流程变量，
     * 影响后续网关路由/表单）；阻断场景下抛异常即拦截办理。
     *
     * @param ctx 事件上下文（trigger/vars/form/execution/task/pid/title/blocking + 原始配置）
     * @throws Exception 阻断场景异常上抛拦截办理；非阻断场景异常被兜底记录不影响流转
     */
    void handle(WfEventContext ctx) throws Exception;
}
