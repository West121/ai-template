package com.hentor.oa.system.datadim;

import java.util.List;

/**
 * 角色/用户在某维度上的授权配置项（GET/PUT roles|users/{id}/data-dimensions 的元素）。
 * scope="ALL"（不限）| "CUSTOM"（仅 values 集内）。
 *
 * <p>V54：feature=所属层（''/null=全局默认层；非空=功能覆盖层）。<b>PUT 按层全量替换</b>——
 * 层由 query 参数 {@code ?feature=} 决定（缺省=全局层），item.feature 忽略；GET 返回项带 feature。
 * dimension 允许内建 {@code dept}（仅覆盖层，CUSTOM values=精确部门 id 集不含子树）。
 */
public record DimensionConfigItem(String dimension, String scope, List<Long> values, String feature) {
}
