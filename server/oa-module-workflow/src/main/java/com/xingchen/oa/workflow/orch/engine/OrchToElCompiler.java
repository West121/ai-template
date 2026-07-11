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
        String el = compilePath(g, startId, new LinkedHashSet<>(), Set.of());
        if (el == null) {
            throw new BusinessException(400, "编排为空：trigger 后无任何节点");
        }
        // LiteFlow 链顶层须为条件表达式（THEN/WHEN/...），单节点链裸 node(...) 会解析失败 → 包一层 THEN
        return el.startsWith("THEN(") || el.startsWith("WHEN(") || el.startsWith("SWITCH(") || el.startsWith("ITERATOR(")
                ? el : "THEN(" + el + ")";
    }

    /** 仅校验（保存时可调）。 */
    public void validate(JsonNode model) {
        compile(model);
    }

    /**
     * 编译一段路径。stopAt=遇到即停（parallel 分支到 JOIN 为止，JOIN 本身不产 EL）。
     */
    private String compilePath(Graph g, String nodeId, Set<String> onPath, Set<String> stopAt) {
        List<String> items = new ArrayList<>();
        String cur = nodeId;
        while (cur != null && !stopAt.contains(cur)) {
            if (!onPath.add(cur)) {
                throw new BusinessException(400, "编排存在环路（节点 " + cur + " 重复进入）；循环请用 loop 节点");
            }
            JsonNode node = g.nodes.get(cur);
            String type = node.path("type").asString("");
            switch (type) {
                case "condition" -> {
                    items.add(compileCondition(g, cur, onPath, stopAt));
                    onPath.remove(cur);
                    cur = null; // 分支各自携带下游，主线到此为止
                }
                case "end" -> {
                    items.add(nodeEl("end", cur));
                    onPath.remove(cur);
                    cur = null;
                }
                case "parallel" -> {
                    String mode = node.path("config").path("mode").asString("OPEN").toUpperCase();
                    if (!"OPEN".equals(mode)) {
                        throw new BusinessException(400, "parallel JOIN 节点不可被直接进入（须由 OPEN 分支汇聚到达）: " + cur);
                    }
                    ParallelBlock block = compileParallel(g, cur, onPath, stopAt);
                    items.add(block.el);
                    String prev = cur;
                    cur = block.continueAt;
                    onPath.remove(prev);
                }
                case "loop" -> {
                    LoopBlock block = compileLoop(g, cur, onPath, stopAt);
                    items.add(block.el);
                    String prev = cur;
                    cur = block.continueAt;
                    onPath.remove(prev);
                }
                default -> {
                    String comp = COMPONENT.get(type);
                    if (comp == null) {
                        throw new BusinessException(400, "未知编排节点类型: " + type + " (" + cur + ")");
                    }
                    List<JsonNode> outs = g.edges.getOrDefault(cur, List.of());
                    // onError=BRANCH：一条 errorBranch:true 出边（失败支）+ 一条正常出边（成功支）
                    JsonNode errorEdge = outs.stream()
                            .filter(e -> e.path("errorBranch").asBoolean(false)).findFirst().orElse(null);
                    if (errorEdge != null) {
                        items.add(compileErrorBranch(g, cur, type, outs, errorEdge, onPath, stopAt));
                        onPath.remove(cur);
                        cur = null; // 成功/失败支各自携带下游
                    } else {
                        items.add(nodeEl(type, cur));
                        if (outs.isEmpty()) {
                            onPath.remove(cur);
                            cur = null;
                        } else if (outs.size() > 1) {
                            throw new BusinessException(400, "动作节点仅允许一条出边（分支请用 condition/parallel 节点）: " + cur);
                        } else {
                            String prev = cur;
                            cur = outs.get(0).path("target").asString("");
                            onPath.remove(prev);
                        }
                    }
                }
            }
        }
        if (items.isEmpty()) {
            return null;
        }
        return items.size() == 1 ? items.get(0) : "THEN(" + String.join(", ", items) + ")";
    }

    private String compileCondition(Graph g, String condId, Set<String> onPath, Set<String> stopAt) {
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
            String sub = compilePath(g, target, new LinkedHashSet<>(onPath), stopAt);
            branches.add("THEN(" + sub + ").id(\"" + target + "\")");
        }
        return "SWITCH(node(\"orchCondition\").tag(\"" + condId + "\")).TO(" + String.join(", ", branches) + ")";
    }

    /**
     * onError=BRANCH（契约裁定形状）：动作节点两条出边——{@code errorBranch:true}=失败支、另一条=成功支。
     * 编译为 THEN(动作, SWITCH(errorRouter).TO(成功支, 失败支))；运行时动作失败被记入 ctx.failedNodes
     * 且不中断，errorRouter 据此路由。节点 onError 需为 BRANCH（校验）。
     */
    private String compileErrorBranch(Graph g, String nodeId, String type, List<JsonNode> outs,
                                      JsonNode errorEdge, Set<String> onPath, Set<String> stopAt) {
        JsonNode node = g.nodes.get(nodeId);
        String onError = node.path("config").path("onError").asString("ABORT").toUpperCase();
        if (!"BRANCH".equals(onError)) {
            throw new BusinessException(400, "带失败支(errorBranch)的节点须 onError=BRANCH: " + nodeId);
        }
        List<JsonNode> normal = outs.stream().filter(e -> !e.path("errorBranch").asBoolean(false)).toList();
        if (normal.size() != 1 || outs.size() != 2) {
            throw new BusinessException(400, "onError=BRANCH 节点须恰有一条成功支 + 一条失败支(errorBranch): " + nodeId);
        }
        String okTarget = normal.get(0).path("target").asString("");
        String errTarget = errorEdge.path("target").asString("");
        String okSub = compilePath(g, okTarget, new LinkedHashSet<>(onPath), stopAt);
        String errSub = compilePath(g, errTarget, new LinkedHashSet<>(onPath), stopAt);
        return "THEN(" + nodeEl(type, nodeId) + ", SWITCH(node(\"orchErrorRouter\").tag(\"" + nodeId + "\")).TO("
                + "THEN(" + okSub + ").id(\"" + okTarget + "\"), "
                + "THEN(" + errSub + ").id(\"" + errTarget + "\")))";
    }

    /**
     * parallel（契约 §2）：OPEN 节点 N(≥2) 条出边为并行分支（编译 WHEN，全到齐汇合），
     * 每条分支须汇聚到<b>同一个</b> JOIN 节点（type=parallel, config.mode=JOIN）；JOIN 单出边续接主线。
     */
    private ParallelBlock compileParallel(Graph g, String openId, Set<String> onPath, Set<String> stopAt) {
        List<JsonNode> outs = g.edges.getOrDefault(openId, List.of());
        if (outs.size() < 2) {
            throw new BusinessException(400, "parallel OPEN 至少两条出边: " + openId);
        }
        // 定位共同 JOIN：沿每条分支 BFS 找首个 parallel JOIN
        String joinId = null;
        for (JsonNode edge : outs) {
            String found = findJoin(g, edge.path("target").asString(""));
            if (found == null) {
                throw new BusinessException(400, "parallel 分支未汇聚到 JOIN 节点: " + openId);
            }
            if (joinId == null) {
                joinId = found;
            } else if (!joinId.equals(found)) {
                throw new BusinessException(400, "parallel 各分支须汇聚到同一 JOIN: " + joinId + " vs " + found);
            }
        }
        Set<String> branchStop = new LinkedHashSet<>(stopAt);
        branchStop.add(joinId);
        List<String> branches = new ArrayList<>();
        for (JsonNode edge : outs) {
            String sub = compilePath(g, edge.path("target").asString(""), new LinkedHashSet<>(onPath), branchStop);
            if (sub == null) {
                throw new BusinessException(400, "parallel 空分支: " + openId);
            }
            branches.add(sub);
        }
        List<JsonNode> joinOuts = g.edges.getOrDefault(joinId, List.of());
        if (joinOuts.size() != 1) {
            throw new BusinessException(400, "parallel JOIN 须恰有一条出边: " + joinId);
        }
        return new ParallelBlock("WHEN(" + String.join(", ", branches) + ")",
                joinOuts.get(0).path("target").asString(""));
    }

    private String findJoin(Graph g, String from) {
        Set<String> seen = new LinkedHashSet<>();
        List<String> queue = new ArrayList<>(List.of(from));
        while (!queue.isEmpty()) {
            String id = queue.remove(0);
            if (!seen.add(id)) {
                continue;
            }
            JsonNode n = g.nodes.get(id);
            if (n != null && "parallel".equals(n.path("type").asString(""))
                    && "JOIN".equalsIgnoreCase(n.path("config").path("mode").asString(""))) {
                return id;
            }
            for (JsonNode e : g.edges.getOrDefault(id, List.of())) {
                queue.add(e.path("target").asString(""));
            }
        }
        return null;
    }

    /**
     * loop（契约 §2 + 裁定形状）：config {collection, itemVar, maxIterations}；两条出边——
     * {@code loopBody:true}=循环体入口（体内路径自然终止，不回连），另一条=循环后续接。
     * 编译 ITERATOR(loop 节点).DO(体)；运行时 loop 组件按 collection 表达式出迭代器并逐项写 vars[itemVar]。
     */
    private LoopBlock compileLoop(Graph g, String loopId, Set<String> onPath, Set<String> stopAt) {
        List<JsonNode> outs = g.edges.getOrDefault(loopId, List.of());
        JsonNode bodyEdge = outs.stream().filter(e -> e.path("loopBody").asBoolean(false)).findFirst().orElse(null);
        List<JsonNode> normal = outs.stream().filter(e -> !e.path("loopBody").asBoolean(false)).toList();
        if (bodyEdge == null || normal.size() != 1 || outs.size() != 2) {
            throw new BusinessException(400, "loop 节点须恰有一条循环体入口(loopBody:true) + 一条后续出边: " + loopId);
        }
        String bodySub = compilePath(g, bodyEdge.path("target").asString(""), new LinkedHashSet<>(onPath), stopAt);
        if (bodySub == null) {
            throw new BusinessException(400, "loop 循环体为空: " + loopId);
        }
        String el = "ITERATOR(node(\"orchLoop\").tag(\"" + loopId + "\")).DO(THEN(" + bodySub + "))";
        return new LoopBlock(el, normal.get(0).path("target").asString(""));
    }

    private record ParallelBlock(String el, String continueAt) {
    }

    private record LoopBlock(String el, String continueAt) {
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
