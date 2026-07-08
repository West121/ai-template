package com.xingchen.oa.workflow.dto;

import java.util.List;

/** 流程监控总览统计（wf_instance_ext 聚合）。 */
public record MonitorOverview(
        long total,
        long running,
        long approved,
        long rejected,
        long canceled,
        long terminated,
        long timeout,
        List<DefCount> byDef) {

    /** 按流程定义维度的实例数。 */
    public record DefCount(String defCode, String defName, long count) {
    }
}
