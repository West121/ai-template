package com.hentor.oa.system.datadim;

import java.util.List;

/**
 * 业务维度信息（GET /api/system/data-dimensions 返回项）。不含内建 dept/self（builtin 恒 false，占位前端渲染）。
 * V51 扩展：valueSource/dictType/bindings（旧消费方只读 code/label/enabled，加字段向后兼容）；
 * entity=首个绑定实体（兼容旧字段语义）。
 */
public record DimensionInfo(String code, String label, String entity, boolean enabled,
                            String valueSource, String dictType,
                            List<DimensionBindingItem> bindings, boolean builtin) {
}
