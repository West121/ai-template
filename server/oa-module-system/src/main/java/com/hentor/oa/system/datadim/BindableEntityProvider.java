package com.hentor.oa.system.datadim;

import java.util.List;

/**
 * 可绑列目录 SPI（V51 绑定白名单）：业务模块声明「哪些实体的哪些列可被维度绑定」，
 * 维度 CRUD 校验 bindings 必须落在目录内（防任意列注入），
 * {@code GET /api/system/data-dimensions/bindable-entities} 暴露给前端绑定 UI。
 *
 * <p>与 {@link DataDimensionProvider} 同款依赖方向：业务模块单向依赖 system 实现本接口，
 * system 注入 {@code List<BindableEntityProvider>} 收集。column 为 <b>JPA 属性名</b>
 * （multiDim root.get 消费口径）。新实体接入维度 = 实现本 SPI + 该实体 Service 调
 * {@code DataScopeSupport.multiDim(entity,...)}。
 */
public interface BindableEntityProvider {

    List<BindableEntity> bindableEntities();

    /** 可绑实体：entity=multiDim 的实体键（如 Approval）；label=人话名。 */
    record BindableEntity(String entity, String label, List<BindableColumn> columns) {
    }

    /** 可绑列：column=JPA 属性名（如 costCenterId）；label=人话名。 */
    record BindableColumn(String column, String label) {
    }
}
