package com.xingchen.oa.workflow.convert.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * 节点尺寸。对应前端 {@code flow/model.ts} 的 {@code Size}。
 * 省略时后端按元素类型给默认：事件 30×30 / 网关 40×40 / 任务 100×60。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Size {
    public double w;
    public double h;
}
