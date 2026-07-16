package com.hentor.oa.workflow.orch.engine.nodes;

import com.hentor.oa.workflow.engine.script.ScriptContext;
import com.hentor.oa.workflow.engine.script.ScriptService;
import com.hentor.oa.workflow.orch.engine.OrchRunContext;
import com.hentor.oa.workflow.orch.engine.OrchSpringHolder;
import tools.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 脚本节点：复用平台 {@link ScriptService}（Tier2 治理/超时/审计沿用）。config {lang, code}。
 * 绑定约定：{@code vars}=编排变量（可读写，写入即生效）；{@code form.payload}/{@code form.outputs}=只读上下文；
 * {@code spring}/{@code log} 门面同脚本节点既有能力。脚本返回值 → 节点输出。
 */
public class OrchScriptNode extends OrchBaseNode {

    @Override
    protected Object inputSummary(OrchRunContext ctx, JsonNode node, JsonNode config) {
        return Map.of("lang", config.path("lang").asString(""),
                "codeLength", config.path("code").asString("").length());
    }

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) {
        String lang = config.path("lang").asString("groovy");
        String code = config.path("code").asString("");
        Map<String, Object> form = new LinkedHashMap<>();
        form.put("payload", ctx.payload);
        form.put("outputs", ctx.outputs);
        ScriptContext scriptCtx = new ScriptContext(ctx.vars, form, null,
                "orch:" + ctx.flowId + "#" + node.path("id").asString(""));
        return OrchSpringHolder.bean(ScriptService.class).run(lang, code, scriptCtx);
    }
}
