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
 * 角色×功能 字段权限（V52，权限中心 P3）。feature=功能键（opaque 字符串，拍板 A）；
 * field=表单字段 key 或 @FieldPerm 固定列名。多角色并集放宽；未配置任何行=全可见全可编。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_role_field_perm",
        uniqueConstraints = @UniqueConstraint(name = "uk_role_field_perm",
                columnNames = {"role_id", "feature", "field"}))
public class SysRoleFieldPerm {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "role_id", nullable = false)
    private Long roleId;

    @Column(nullable = false, length = 64)
    private String feature;

    @Column(nullable = false, length = 64)
    private String field;

    @Column(nullable = false)
    private Boolean visible = true;

    @Column(nullable = false)
    private Boolean editable = true;
}
