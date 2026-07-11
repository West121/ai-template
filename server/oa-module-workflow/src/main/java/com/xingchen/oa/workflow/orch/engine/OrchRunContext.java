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

    /** wait 节点标记：本段执行完时非空 → exec 挂起（WAITING），恢复后执行该节点的后继段。 */
    public volatile String waitNodeId;

    /** webhook 同步响应（§9.4）：respond 节点 complete；非 webhook 触发为 null。 */
    public volatile java.util.concurrent.CompletableFuture<Map<String, Object>> respondFuture;

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

    /** 恢复执行：从快照回填 vars/outputs/failedNodes（payload 由构造器传入）。 */
    public void preload(Map<String, Object> savedVars, Map<String, Object> savedOutputs,
                        java.util.Collection<String> savedFailed) {
        if (savedVars != null) {
            vars.putAll(savedVars);
        }
        if (savedOutputs != null) {
            outputs.putAll(savedOutputs);
        }
        if (savedFailed != null) {
            failedNodes.addAll(savedFailed);
        }
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
