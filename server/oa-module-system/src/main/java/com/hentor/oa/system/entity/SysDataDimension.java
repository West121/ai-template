package com.hentor.oa.system.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 数据维度元数据（配置化，不硬编码）：改维度 = 改此表的数据（+ 对应 provider bean + 实体列）。
 * 内建 dept/self 不入此表（走既有 dataScope）。code 为主键（业务编码）。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_data_dimension")
public class SysDataDimension {

    public static final String SCOPE_ALL = "ALL";
    public static final String SCOPE_CUSTOM = "CUSTOM";

    /** 维度编码（如 costCenter / project），与 {@link com.hentor.oa.system.datadim.DataDimensionProvider#code()} 对应。 */
    @Id
    @Column(length = 64)
    private String code;

    @Column(nullable = false, length = 64)
    private String label;

    /** 关联业务实体提示（如 Approval），仅前端展示用，可空。 */
    @Column(length = 128)
    private String entity;

    /** 实体默认列名（如 cost_center_id），文档/默认用；实际过滤列由调用方按实体绑定传入。 */
    @Column(name = "column_name", length = 64)
    private String columnName;

    @Column(nullable = false)
    private Boolean enabled = true;
}
