package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.engine.OrchTemplate;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;

/** 结束节点：可选 config.output（Aviator 表达式）→ 流水结果（orch_exec.result）。 */
public class OrchEndNode extends OrchBaseNode {

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) {
        String outputExpr = config.path("output").asString(null);
        Object result = null;
        if (StringUtils.hasText(outputExpr)) {
            result = OrchSpringHolder.bean(OrchTemplate.class).eval(outputExpr, ctx.evalCtx());
        }
        ctx.result = result;
        return result;
    }
}
