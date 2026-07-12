package com.xingchen.oa.system.datadim;

/**
 * 已注册业务维度信息（GET /api/system/data-dimensions 返回项）。不含内建 dept/self。
 */
public record DimensionInfo(String code, String label, String entity, boolean enabled) {
}
