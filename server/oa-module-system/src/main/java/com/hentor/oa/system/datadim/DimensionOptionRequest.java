package com.hentor.oa.system.datadim;

/** 选项新建/编辑请求：value 缺省自动取该维 max+1；PUT 时 value 不可改（label/sort/enabled 可）。 */
public record DimensionOptionRequest(Long value, String label, Integer sort, Boolean enabled) {
}
