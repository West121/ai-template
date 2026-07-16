package com.hentor.oa.system.entity;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

import java.util.HashSet;
import java.util.Set;

/**
 * 用户在某数据维度上的可见范围配置（覆盖/叠加角色配置，见 DataDimensionService 解析语义）。
 * scope=ALL（不限）/ CUSTOM（仅 values 集内）。(user_id, dimension) 唯一。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_user_data_dimension",
        uniqueConstraints = @UniqueConstraint(name = "uk_user_data_dim", columnNames = {"user_id", "dimension", "feature"}))
public class SysUserDataDimension {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, length = 64)
    private String dimension;

    /** V54 功能覆盖层：''=全局默认；非空=按功能覆盖（feature_code opaque 字符串，覆盖=替换全局）。 */
    @Column(nullable = false, length = 64)
    private String feature = "";

    @Column(nullable = false, length = 16)
    private String scope;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "sys_user_data_dimension_value", joinColumns = @JoinColumn(name = "config_id"))
    @Column(name = "value")
    private Set<Long> values = new HashSet<>();
}
