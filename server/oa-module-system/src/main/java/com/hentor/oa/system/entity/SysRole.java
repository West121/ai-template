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
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.HashSet;
import java.util.Set;

/**
 * 角色。data_scope 取值：ALL / DEPT_AND_CHILD / DEPT / SELF / CUSTOM。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_role")
public class SysRole {

    public static final String SCOPE_ALL = "ALL";
    public static final String SCOPE_DEPT_AND_CHILD = "DEPT_AND_CHILD";
    public static final String SCOPE_DEPT = "DEPT";
    public static final String SCOPE_SELF = "SELF";
    public static final String SCOPE_CUSTOM = "CUSTOM";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String code;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(name = "data_scope", nullable = false, length = 20)
    private String dataScope;

    @Column
    private Integer sort;

    @Column(nullable = false)
    private Boolean enabled = true;

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(name = "sys_role_permission",
            joinColumns = @JoinColumn(name = "role_id"),
            inverseJoinColumns = @JoinColumn(name = "permission_id"))
    private Set<SysPermission> permissions = new HashSet<>();

    /**
     * CUSTOM 数据范围时的自定义可见部门集合（sys_role_dept）。
     */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "sys_role_dept", joinColumns = @JoinColumn(name = "role_id"))
    @Column(name = "dept_id")
    private Set<Long> customDeptIds = new HashSet<>();
}
