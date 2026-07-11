package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.engine.OrchTemplate;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 数据映射节点：config {assignments: [{target: "varName", expr: "Aviator 表达式"}]} → vars[target]=eval(expr)。
 * 契约字段名 <b>assignments</b>（§2，与前端一致）；读不到时兼容旧 assigns。输出 = 本次赋值结果集。
 */
public class OrchDataMapNode extends OrchBaseNode {

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        Map<String, Object> assigned = new LinkedHashMap<>();
        JsonNode assignments = config.path("assignments").isArray() && !config.path("assignments").isEmpty()
                ? config.path("assignments")
                : config.path("assigns");
        for (JsonNode assign : assignments) {
            String target = assign.path("target").asString(null);
            String expr = assign.path("expr").asString(null);
            if (!StringUtils.hasText(target) || !StringUtils.hasText(expr)) {
                continue;
            }
            Object value = tpl.eval(expr, ctx.evalCtx());
            ctx.vars.put(target, value);
            assigned.put(target, value);
        }
        return assigned;
    }
}
