package com.hentor.oa.workflow.orch.engine.nodes;

import com.hentor.oa.workflow.orch.engine.OrchRunContext;
import tools.jackson.databind.JsonNode;

import java.util.Map;

/** 延时节点：config.ms（上限 5 分钟——编排是短事务，长等待用审批流）。 */
public class OrchDelayNode extends OrchBaseNode {

    private static final long MAX_MS = 5 * 60 * 1000L;

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) throws Exception {
        long ms = Math.max(0, Math.min(config.path("ms").asLong(0), MAX_MS));
        if (ms > 0) {
            Thread.sleep(ms);
        }
        return Map.of("delayedMs", ms);
    }
}
