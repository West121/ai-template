package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.orch.engine.OrchNodeLogger;
import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.entity.OrchExecNode;
import com.yomahub.liteflow.core.NodeComponent;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;

/**
 * 编排动作节点基类：统一 节点留痕（input/output/耗时/attempts）+ retry（times/intervalMs/backoff 指数退避）
 * + onError（ABORT 默认中断整流 / CONTINUE 记失败继续）语义。子类只实现 {@link #doExecute}。
 * 组件由 LiteFlow 反射实例化，平台服务经 {@link OrchSpringHolder} 获取。
 */
public abstract class OrchBaseNode extends NodeComponent {

    @Override
    public void process() throws Exception {
        OrchRunContext ctx = this.getContextBean(OrchRunContext.class);
        String nodeId = this.getTag();
        JsonNode node = ctx.node(nodeId);
        if (node == null) {
            throw new IllegalStateException("编排节点不存在: " + nodeId);
        }
        JsonNode config = node.path("config");
        OrchNodeLogger logger = OrchSpringHolder.bean(OrchNodeLogger.class);

        int retryTimes = Math.max(0, Math.min(config.path("retry").path("times").asInt(0), 10));
        long interval = Math.max(0, config.path("retry").path("intervalMs").asLong(1000));
        boolean backoff = config.path("retry").path("backoff").asBoolean(false);
        String onError = config.path("onError").asString("ABORT").toUpperCase();

        Object input = null;
        try {
            input = inputSummary(ctx, node, config);
        } catch (Exception ignored) {
            // 输入摘要失败不阻断执行
        }
        OrchExecNode row = logger.start(ctx.execId, nodeId, node.path("name").asString(nodeId), input);
        long start = System.currentTimeMillis();
        Exception last = null;
        for (int attempt = 1; attempt <= retryTimes + 1; attempt++) {
            try {
                Object output = doExecute(ctx, node, config);
                ctx.outputs.put(nodeId, output);
                String saveAs = config.path("saveAs").asString(null);
                if (StringUtils.hasText(saveAs)) {
                    ctx.vars.put(saveAs, output);
                }
                logger.finish(row, true, output, null, attempt, System.currentTimeMillis() - start);
                return;
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                logger.finish(row, false, null, "执行被中断", attempt, System.currentTimeMillis() - start);
                throw ie;
            } catch (Exception e) {
                last = e;
                if (attempt <= retryTimes) {
                    long sleep = backoff ? interval * (1L << (attempt - 1)) : interval;
                    Thread.sleep(Math.min(sleep, 60_000));
                }
            }
        }
        String error = last != null ? String.valueOf(last.getMessage()) : "未知错误";
        logger.finish(row, false, null, error, retryTimes + 1, System.currentTimeMillis() - start);
        ctx.failedNodes.add(nodeId);
        if ("CONTINUE".equals(onError) || "BRANCH".equals(onError)) {
            // CONTINUE：失败继续输出置空；BRANCH：不中断，由 orchErrorRouter 按 failedNodes 路由失败支
            ctx.outputs.put(nodeId, null);
            ctx.vars.put("__lastError", error);
            return;
        }
        throw new IllegalStateException("节点[" + nodeId + "]执行失败: " + error, last);
    }

    /** 节点输入摘要（留痕用，渲染后的关键请求参数；缺省 config 原文）。 */
    protected Object inputSummary(OrchRunContext ctx, JsonNode node, JsonNode config) {
        return config.isMissingNode() || config.isNull() ? null : config.toString();
    }

    /** 执行并返回输出（入 outputs[nodeId]；异常触发 retry/onError）。 */
    protected abstract Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) throws Exception;
}
