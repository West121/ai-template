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
 * 角色在某数据维度上的可见范围配置。scope=ALL（不限）/ CUSTOM（仅 values 集内）。
 * (role_id, dimension) 唯一。仅业务维度（costCenter/project…）；dept/self 不入此表。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_role_data_dimension",
        uniqueConstraints = @UniqueConstraint(name = "uk_role_data_dim", columnNames = {"role_id", "dimension"}))
public class SysRoleDataDimension {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "role_id", nullable = false)
    private Long roleId;

    @Column(nullable = false, length = 64)
    private String dimension;

    @Column(nullable = false, length = 16)
    private String scope;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "sys_role_data_dimension_value", joinColumns = @JoinColumn(name = "config_id"))
    @Column(name = "value")
    private Set<Long> values = new HashSet<>();
}
