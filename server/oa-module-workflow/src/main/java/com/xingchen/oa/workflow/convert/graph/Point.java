package com.xingchen.oa.workflow.convert.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * 画布坐标点（BPMN DI 单位，左上原点，向右下为正）。对应前端 {@code flow/model.ts} 的 {@code Point}。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Point {
    public double x;
    public double y;

    public Point() {
    }

    public Point(double x, double y) {
        this.x = x;
        this.y = y;
    }
}
