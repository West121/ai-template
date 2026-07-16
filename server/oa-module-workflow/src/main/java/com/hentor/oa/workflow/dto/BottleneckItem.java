package com.hentor.oa.workflow.dto;

/** 节点瓶颈分析项：某 userTask 节点的平均停留时长与样本数。 */
public record BottleneckItem(
        String defCode,
        String defName,
        String nodeId,
        String nodeName,
        long avgDurationMs,
        long count) {
}
