package com.xingchen.oa.workflow.orch.engine;

import tools.jackson.databind.JsonNode;

import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 编排一次执行的 LiteFlow 上下文 bean（契约 §2 数据流）：
 * payload（触发载荷）+ vars（dataMap/脚本写入）+ outputs[nodeId]（各节点输出）。
 * 组件经 {@code getContextBean(OrchRunContext.class)} 读写；模板/条件求值上下文 = {@link #evalCtx()}。
 */
public class OrchRunContext {

    public final long execId;
    public final long flowId;
    /** 子编排深度（subFlow 护栏 ≤5）。 */
    public final int depth;

    public final Map<String, Object> payload;
    /** 同步 Map：parallel(WHEN) 分支并发写安全。 */
    public final Map<String, Object> vars = Collections.synchronizedMap(new LinkedHashMap<>());
    public final Map<String, Object> outputs = Collections.synchronizedMap(new LinkedHashMap<>());
    /** onError=BRANCH：失败节点集合（errorRouter 据此路由失败支）。 */
    public final Set<String> failedNodes = ConcurrentHashMap.newKeySet();

    /** end 节点写入的流水结果。 */
    public volatile Object result;

    private final Map<String, JsonNode> nodeById = new HashMap<>();
    private final Map<String, List<JsonNode>> edgesBySource;

    public OrchRunContext(long execId, long flowId, int depth, Map<String, Object> payload,
                          List<JsonNode> nodes, Map<String, List<JsonNode>> edgesBySource) {
        this.execId = execId;
        this.flowId = flowId;
        this.depth = depth;
        this.payload = payload == null ? new LinkedHashMap<>() : payload;
        for (JsonNode n : nodes) {
            nodeById.put(n.path("id").asString(""), n);
        }
        this.edgesBySource = edgesBySource;
    }

    public JsonNode node(String id) {
        return nodeById.get(id);
    }

    public List<JsonNode> outgoing(String nodeId) {
        return edgesBySource.getOrDefault(nodeId, List.of());
    }

    /** Aviator 求值上下文：payload / vars / outputs 三棵树（引用共享，写 vars 即生效）。 */
    public Map<String, Object> evalCtx() {
        Map<String, Object> ctx = new LinkedHashMap<>();
        ctx.put("payload", payload);
        ctx.put("vars", vars);
        ctx.put("outputs", outputs);
        return ctx;
    }
}
