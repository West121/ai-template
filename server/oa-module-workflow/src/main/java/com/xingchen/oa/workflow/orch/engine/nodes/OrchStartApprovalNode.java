package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.engine.OrchTemplate;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.runtime.ProcessInstance;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 发起审批流节点：config {defCode, title(模板), formData: {字段: 模板}, initiatorId?}。
 * 走共享 Flowable 引擎直起 + __wfRegister 标记（引擎级监听自动注册 wf_instance_ext，
 * 实例在 我发起/待办/监控 一等可见）。输出 {procInstId}。
 */
public class OrchStartApprovalNode extends OrchBaseNode {

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        Map<String, Object> evalCtx = ctx.evalCtx();
        String defCode = config.path("defCode").asString(null);
        if (!StringUtils.hasText(defCode)) {
            throw new IllegalStateException("startApproval 节点缺少 defCode");
        }
        String title = tpl.renderString(config.path("title").asString("编排发起：" + defCode), evalCtx);
        long initiatorId = config.path("initiatorId").asLong(1); // 缺省系统管理员名义发起

        Map<String, Object> vars = new LinkedHashMap<>();
        vars.put("initiatorId", initiatorId);
        vars.put("initiatorName", "自动化编排");
        vars.put("__wfRegister", true);
        vars.put("__title", title);
        for (Map.Entry<String, JsonNode> e : config.path("formData").properties()) {
            Object v = tpl.render(e.getValue().asString(""), evalCtx);
            vars.put(e.getKey(), v);
        }
        RuntimeService runtimeService = OrchSpringHolder.bean(RuntimeService.class);
        ProcessInstance pi = runtimeService.startProcessInstanceByKey(defCode, vars);
        runtimeService.setProcessInstanceName(pi.getId(), title);
        return Map.of("procInstId", pi.getProcessInstanceId());
    }
}
