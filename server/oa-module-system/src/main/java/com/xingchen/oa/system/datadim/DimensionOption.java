package com.xingchen.oa.system.datadim;

/**
 * 数据维度的一个 CUSTOM 可选值（id + 展示名），供授权配置 UI 勾选。
 */
public record DimensionOption(Long id, String label) {
}
