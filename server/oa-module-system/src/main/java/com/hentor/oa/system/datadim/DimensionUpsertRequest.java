package com.hentor.oa.system.datadim;

import java.util.List;

/**
 * 维度新建/编辑请求（V51 CRUD）。POST 全字段；PUT 忽略 code（路径为准）与 valueSource（建后不可改），
 * label/enabled/dictType/bindings 按传入替换（bindings=null 不动，非 null 全量替换）。
 */
public record DimensionUpsertRequest(String code, String label, String valueSource, String dictType,
                                     Boolean enabled, List<DimensionBindingItem> bindings) {
}
