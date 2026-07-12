package com.xingchen.oa.system.datadim;

import java.util.List;

/**
 * 角色/用户在某维度上的授权配置项（GET/PUT roles|users/{id}/data-dimensions 的元素）。
 * scope="ALL"（不限）| "CUSTOM"（仅 values 集内）。PUT 全量替换。
 */
public record DimensionConfigItem(String dimension, String scope, List<Long> values) {
}
