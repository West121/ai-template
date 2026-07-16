package com.hentor.oa.workflow.engine;

import org.flowable.engine.delegate.DelegateExecution;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/**
 * 内置示例触发器（P3）：把触发时间写入流程变量 {@code wfTriggerEcho}，供演示/联调断言。
 * 生产触发器实现同样以 bean 名注册，节点 props.handler 指向该名即可被 {@link TriggerDelegate} 调用。
 */
@Component("wfEchoTrigger")
public class EchoTrigger implements WfTrigger {

    @Override
    public void execute(DelegateExecution execution, JsonNode config) {
        execution.setVariable("wfTriggerEcho", System.currentTimeMillis());
        if (config != null && config.has("var")) {
            execution.setVariable(config.path("var").asString("wfTriggerFlag"), true);
        }
    }
}
