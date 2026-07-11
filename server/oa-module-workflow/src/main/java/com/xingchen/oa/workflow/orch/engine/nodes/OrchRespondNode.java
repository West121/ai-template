package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.engine.OrchTemplate;
import tools.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * respond 节点（§9.4 Webhook 同步响应）：config {status?(默认200), body(模板), contentType?(默认 application/json)}。
 * webhook 同步触发时 complete ctx.respondFuture（hooks 端点据此回写 HTTP 响应），后续节点继续异步；
 * 非 webhook 触发时等价 dataMap（渲染结果入 outputs，不报错）。
 */
public class OrchRespondNode extends OrchBaseNode {

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        Object body = config.hasNonNull("body")
                ? tpl.render(config.path("body").asString(""), ctx.evalCtx()) : null;
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("status", config.path("status").asInt(200));
        resp.put("contentType", config.path("contentType").asString("application/json"));
        resp.put("body", body);
        var future = ctx.respondFuture;
        if (future != null) {
            future.complete(resp);
        }
        return resp;
    }
}
