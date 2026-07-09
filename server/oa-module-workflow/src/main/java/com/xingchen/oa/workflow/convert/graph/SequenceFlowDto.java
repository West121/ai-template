package com.xingchen.oa.workflow.convert.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import tools.jackson.databind.JsonNode;

import java.util.List;

/**
 * 归一化连线。对应前端 {@code flow/model.ts} 的 {@code SequenceFlow}，1:1 映射 BPMN sequenceFlow。
 *
 * <p>条件二选一互斥（附录 C.4，优先级 {@code expression} &gt; {@code condition}）：
 * <ul>
 *   <li>{@code condition}：结构化 {@code BranchCondition}（{@code logic} + {@code items[]}），
 *       经 {@code ConditionCompiler} 编译为 UEL（跨端字节兼容红线，保持不变）。保持原始 {@link JsonNode}
 *       以复用 {@code ConditionCompiler}。</li>
 *   <li>{@code expression}：高级公式条件逃生口，原样作为 conditionExpression 下发（Tier 1 引擎路径）。</li>
 * </ul>
 * 同一条边二者不得同时存在，转换器会拦截。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class SequenceFlowDto {
    public String id;
    /** 源节点 id */
    public String source;
    /** 目标节点 id */
    public String target;
    /** 连线标签（可空） */
    public String name;
    /** 拐点坐标序列，生成 BPMNEdge waypoints；缺省时按源右中→目标左中兜底 */
    public List<Point> waypoints;
    /** 默认分支：source 为网关时其余出边都不满足则走此边（gateway.default 的唯一真相源） */
    public Boolean isDefault;
    /** 简单结构化条件（编译 UEL，跨端兼容 ConditionCompiler） */
    public JsonNode condition;
    /** 高级公式条件（原样下发）；与 condition 互斥，优先级更高 */
    public String expression;
}
