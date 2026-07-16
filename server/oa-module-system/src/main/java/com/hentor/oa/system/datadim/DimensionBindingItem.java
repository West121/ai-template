package com.hentor.oa.system.datadim;

/** 维度绑定项（CRUD 出入参 bindings 元素）：column=JPA 属性名。 */
public record DimensionBindingItem(String entity, String column) {
}
