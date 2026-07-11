package com.xingchen.oa.workflow.orch.engine;

import com.xingchen.oa.common.exception.BusinessException;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * OrchModel（契约 §2 图 JSON）→ LiteFlow EL 编译器。
 *
 * <p>编译规则：动作节点 → {@code node("orch<Type>").tag("<nodeId>")}（组件运行时按 tag 从
 * {@link OrchRunContext} 取节点 config）；线性路径 → THEN(...)；condition → SWITCH 组件 +
 * 每条出边分支 {@code THEN(下游路径).ID("<targetId>")}，条件组件求值出边返回目标 id。
 * 分支各自携带完整下游路径（汇合节点在 EL 中重复出现，执行只走单支，语义正确）。
 *
 * <p>校验（发布即编译）：单 trigger / 节点 id 合法 / 边端点存在 / 无环 / condition 有唯一默认支 /
 * 动作节点单出边。parallel/loop 属下一批（WHEN/ITERATOR），当前报不支持。
 */
@Component
public class OrchToElCompiler {

    private static final Pattern ID_PATTERN = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    /** type → LiteFlow 组件 id（组件注册见 {@link OrchLiteFlow}）。 */
    private static final Map<String, String> COMPONENT = Map.ofEntries(
            Map.entry("http", "orchHttp"),
            Map.entry("script", "orchScript"),
            Map.entry("dataMap", "orchDataMap"),
            Map.entry("llm", "orchLlm"),
            Map.entry("notify", "orchNotify"),
            Map.entry("delay", "orchDelay"),
            Map.entry("startApproval", "orchStartApproval"),
            Map.entry("subFlow", "orchSubFlow"),
            Map.entry("end", "orchEnd"));

    /** 编译（含全量校验）。@return LiteFlow EL 表达式 */
    public String compile(JsonNode model) {
        Graph g = parse(model);
        String startId = singleTarget(g, g.triggerId, "trigger");
        Set<String> onPath = new LinkedHashSet<>();
        String el = compilePath(g, startId, onPath);
        if (el == null) {
            throw new BusinessException(400, "编排为空：trigger 后无任何节点");
        }
        return el;
    }

    /** 仅校验（保存时可调）。 */
    public void validate(JsonNode model) {
        compile(model);
    }

    private String compilePath(Graph g, String nodeId, Set<String> onPath) {
        List<String> items = new ArrayList<>();
        String cur = nodeId;
        while (cur != null) {
            if (!onPath.add(cur)) {
                throw new BusinessException(400, "编排存在环路（节点 " + cur + " 重复进入）；loop 请用 loop 节点（下一批）");
            }
            JsonNode node = g.nodes.get(cur);
            String type = node.path("type").asString("");
            switch (type) {
                case "condition" -> {
                    items.add(compileCondition(g, cur, onPath));
                    onPath.remove(cur);
                    cur = null; // 分支各自携带下游，主线到此为止
                }
                case "end" -> {
                    items.add(nodeEl("end", cur));
                    onPath.remove(cur);
                    cur = null;
                }
                case "parallel", "loop" -> throw new BusinessException(400,
                        "节点类型暂不支持（下一批 WHEN/ITERATOR）: " + type);
                default -> {
                    String comp = COMPONENT.get(type);
                    if (comp == null) {
                        throw new BusinessException(400, "未知编排节点类型: " + type + " (" + cur + ")");
                    }
                    items.add(nodeEl(type, cur));
                    List<JsonNode> outs = g.edges.getOrDefault(cur, List.of());
                    if (outs.isEmpty()) {
                        onPath.remove(cur);
                        cur = null;
                    } else if (outs.size() > 1) {
                        throw new BusinessException(400, "动作节点仅允许一条出边（分支请用 condition 节点）: " + cur);
                    } else {
                        String prev = cur;
                        cur = outs.get(0).path("target").asString("");
                        onPath.remove(prev);
                    }
                }
            }
        }
        if (items.isEmpty()) {
            return null;
        }
        return items.size() == 1 ? items.get(0) : "THEN(" + String.join(", ", items) + ")";
    }

    private String compileCondition(Graph g, String condId, Set<String> onPath) {
        List<JsonNode> outs = g.edges.getOrDefault(condId, List.of());
        if (outs.size() < 2) {
            throw new BusinessException(400, "condition 节点至少两条出边: " + condId);
        }
        long defaults = outs.stream().filter(e -> e.path("isDefault").asBoolean(false)).count();
        if (defaults != 1) {
            throw new BusinessException(400, "condition 节点须恰有一条默认支(isDefault): " + condId);
        }
        List<String> branches = new ArrayList<>();
        for (JsonNode edge : outs) {
            String target = edge.path("target").asString("");
            // 每条分支独立路径栈（汇合节点允许在不同分支重复出现）；.id() 供 SWITCH 按目标节点 id 路由
            String sub = compilePath(g, target, new LinkedHashSet<>(onPath));
            branches.add("THEN(" + sub + ").id(\"" + target + "\")");
        }
        return "SWITCH(node(\"orchCondition\").tag(\"" + condId + "\")).TO(" + String.join(", ", branches) + ")";
    }

    private String nodeEl(String type, String nodeId) {
        return "node(\"" + COMPONENT.get(type) + "\").tag(\"" + nodeId + "\")";
    }

    private String singleTarget(Graph g, String nodeId, String label) {
        List<JsonNode> outs = g.edges.getOrDefault(nodeId, List.of());
        if (outs.size() != 1) {
            throw new BusinessException(400, label + " 节点须恰有一条出边: " + nodeId);
        }
        return outs.get(0).path("target").asString("");
    }

    /** 解析 + 结构校验。 */
    private Graph parse(JsonNode model) {
        if (model == null || !model.path("nodes").isArray()) {
            throw new BusinessException(400, "OrchModel 缺少 nodes");
        }
        Graph g = new Graph();
        for (JsonNode n : model.path("nodes")) {
            String id = n.path("id").asString("");
            if (!ID_PATTERN.matcher(id).matches()) {
                throw new BusinessException(400, "节点 id 非法（仅字母数字-_，≤64）: " + id);
            }
            if (g.nodes.put(id, n) != null) {
                throw new BusinessException(400, "节点 id 重复: " + id);
            }
            if ("trigger".equals(n.path("type").asString(""))) {
                if (g.triggerId != null) {
                    throw new BusinessException(400, "编排仅允许一个 trigger 节点");
                }
                g.triggerId = id;
            }
        }
        if (g.triggerId == null) {
            throw new BusinessException(400, "编排缺少 trigger 节点");
        }
        for (JsonNode e : model.path("edges")) {
            String src = e.path("source").asString("");
            String tgt = e.path("target").asString("");
            if (!g.nodes.containsKey(src) || !g.nodes.containsKey(tgt)) {
                throw new BusinessException(400, "连线端点不存在: " + src + " → " + tgt);
            }
            g.edges.computeIfAbsent(src, k -> new ArrayList<>()).add(e);
        }
        return g;
    }

    /** 供执行侧复用的图结构（edgesBySource）。 */
    public Map<String, List<JsonNode>> edgesBySource(JsonNode model) {
        Map<String, List<JsonNode>> out = new HashMap<>();
        for (JsonNode e : model.path("edges")) {
            out.computeIfAbsent(e.path("source").asString(""), k -> new ArrayList<>()).add(e);
        }
        return out;
    }

    private static final class Graph {
        final Map<String, JsonNode> nodes = new HashMap<>();
        final Map<String, List<JsonNode>> edges = new HashMap<>();
        String triggerId;
    }
}
