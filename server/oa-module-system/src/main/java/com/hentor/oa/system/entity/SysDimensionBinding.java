package com.hentor.oa.system.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

/**
 * 维度↔实体绑定（V51，缺口①：绑定升格为真元数据）。查询侧 {@code DataScopeSupport.multiDim(entity,...)}
 * 按 entity 读本表拼多维谓词（替代调用方代码常量）。{@code columnName} 存 <b>JPA 属性名</b>
 * （如 costCenterId，Criteria root.get 消费口径，非 DB 列名）。P1 单实体单列，(dimension, entity) 唯一。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_dimension_binding",
        uniqueConstraints = @UniqueConstraint(name = "uk_dim_binding", columnNames = {"dimension", "entity"}))
public class SysDimensionBinding {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String dimension;

    /** 可绑列目录内的实体名（如 Approval）。 */
    @Column(nullable = false, length = 128)
    private String entity;

    /** JPA 属性名（multiDim root.get 消费）。 */
    @Column(name = "column_name", nullable = false, length = 64)
    private String columnName;
}
