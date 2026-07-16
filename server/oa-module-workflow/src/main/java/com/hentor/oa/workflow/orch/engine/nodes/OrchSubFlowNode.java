package com.hentor.oa.workflow.orch.engine.nodes;

import com.hentor.oa.workflow.orch.engine.OrchRunContext;
import com.hentor.oa.workflow.orch.engine.OrchSpringHolder;
import com.hentor.oa.workflow.orch.engine.OrchTemplate;
import com.hentor.oa.workflow.orch.service.OrchExecService;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 子编排节点（P0）：config {flowCode, payload: {键: 模板}, waitResult}。
 * waitResult=true 同线程同步执行子编排并返回 {execId,status,result}；false 异步只返回 {execId}。
 * 深度护栏 ≤5（防递归失控）。
 */
public class OrchSubFlowNode extends OrchBaseNode {

    private static final int MAX_DEPTH = 5;

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) {
        if (ctx.depth >= MAX_DEPTH) {
            throw new IllegalStateException("子编排深度超限(≤" + MAX_DEPTH + ")");
        }
        String flowCode = config.path("flowCode").asString(null);
        if (!StringUtils.hasText(flowCode)) {
            throw new IllegalStateException("subFlow 节点缺少 flowCode");
        }
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        Map<String, Object> evalCtx = ctx.evalCtx();
        Map<String, Object> subPayload = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> e : config.path("payload").properties()) {
            subPayload.put(e.getKey(), tpl.render(e.getValue().asString(""), evalCtx));
        }
        boolean wait = config.path("waitResult").asBoolean(true);
        return OrchSpringHolder.bean(OrchExecService.class)
                .runSubFlow(flowCode, subPayload, ctx.depth + 1, wait);
    }
}
