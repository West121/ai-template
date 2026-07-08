package com.xingchen.oa.workflow.engine;

import org.flowable.engine.delegate.DelegateExecution;
import tools.jackson.databind.JsonNode;

/**
 * 触发器 SPI（P3）：触发节点 serviceTask 按配置的 handler 名称查找对应 bean 并执行业务逻辑，
 * 执行完毕流程自动进入下一步。实现类以 bean 名注册（如 {@code @Component("myTrigger")}），
 * 节点 props.handler 指向该名。config 为节点 props.config 扩展（可空）。
 */
public interface WfTrigger {

    /**
     * @param execution 当前执行（可 setVariable 影响后续条件/路由）
     * @param config    节点触发配置 JSON（可空）
     */
    void execute(DelegateExecution execution, JsonNode config);
}
