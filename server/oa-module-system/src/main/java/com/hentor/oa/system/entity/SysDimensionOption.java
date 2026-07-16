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
 * 维度自定义选项（V51，valueSource=OPTION 的取值来源）。
 * {@code value} 即授权值 = 行数据列值（同域，拍板①值链路保持 Long）；(dimension, value) 唯一。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_dimension_option",
        uniqueConstraints = @UniqueConstraint(name = "uk_dim_option", columnNames = {"dimension", "value"}))
public class SysDimensionOption {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String dimension;

    /** 授权值/行数据列值（BIGINT 同域）；建后不可改（改值=删旧建新）。 */
    @Column(nullable = false)
    private Long value;

    @Column(nullable = false, length = 64)
    private String label;

    @Column(nullable = false)
    private Integer sort = 0;

    @Column(nullable = false)
    private Boolean enabled = true;
}
