package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.convert.ConditionEvaluator;
import com.xingchen.oa.workflow.orch.engine.OrchNodeLogger;
import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.engine.OrchTemplate;
import com.xingchen.oa.workflow.orch.entity.OrchExecNode;
import com.yomahub.liteflow.core.NodeSwitchComponent;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 条件节点（LiteFlow SWITCH）：按出边顺序求值，命中即路由到该边 target（EL 分支 .ID(targetId)）；
 * 全不中走默认支（isDefault）。条件二形：{@code expression}（Aviator，上下文 payload/vars/outputs）
 * 或结构化 {@code {logic, items[]}}（ConditionEvaluator，上下文为 payload+vars 顶层平铺）。
 */
public class OrchConditionNode extends NodeSwitchComponent {

    @Override
    public String processSwitch() throws Exception {
        OrchRunContext ctx = this.getContextBean(OrchRunContext.class);
        String nodeId = this.getTag();
        JsonNode node = ctx.node(nodeId);
        OrchNodeLogger logger = OrchSpringHolder.bean(OrchNodeLogger.class);
        OrchExecNode row = logger.start(ctx.execId, nodeId,
                node != null ? node.path("name").asString(nodeId) : nodeId, null);
        long start = System.currentTimeMillis();
        try {
            OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
            String defaultTarget = null;
            String chosen = null;
            for (JsonNode edge : ctx.outgoing(nodeId)) {
                String target = edge.path("target").asString("");
                if (edge.path("isDefault").asBoolean(false)) {
                    defaultTarget = target;
                    continue;
                }
                if (chosen == null && matches(edge.path("condition"), ctx, tpl)) {
                    chosen = target;
                }
            }
            String result = chosen != null ? chosen : defaultTarget;
            if (result == null) {
                throw new IllegalStateException("条件节点无命中分支且无默认支: " + nodeId);
            }
            logger.finish(row, true, Map.of("branch", result, "matched", chosen != null),
                    null, 1, System.currentTimeMillis() - start);
            return result;
        } catch (Exception e) {
            logger.finish(row, false, null, e.getMessage(), 1, System.currentTimeMillis() - start);
            throw e;
        }
    }

    private boolean matches(JsonNode condition, OrchRunContext ctx, OrchTemplate tpl) {
        if (condition == null || condition.isMissingNode() || condition.isNull()) {
            return false;
        }
        String expr = condition.path("expression").asString(null);
        if (StringUtils.hasText(expr)) {
            return tpl.evalBoolean(expr, ctx.evalCtx());
        }
        // 结构化条件：字段名对 payload+vars 顶层平铺求值（复用 ConditionEvaluator）
        if (condition.path("items").isArray() && !condition.path("items").isEmpty()) {
            Map<String, Object> flat = new LinkedHashMap<>(ctx.payload);
            flat.putAll(ctx.vars);
            return ConditionEvaluator.eval(condition.path("items"),
                    condition.path("logic").asString("AND"), flat);
        }
        return false;
    }
}
