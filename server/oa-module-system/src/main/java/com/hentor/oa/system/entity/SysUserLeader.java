package com.hentor.oa.system.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户指定直属上级（多值、有序）。一个用户可配多个直属上级，按 {@code sortOrder} 排序。
 * 供工作流 LEADER（发起人主管）节点解析：配了用指定的，没配回退部门负责人。
 * 与 {@code SysUser.leaderId}（组织架构单值直属上级，展示用）并存、互不影响。
 * 注：{@code tenant_id} 列为多租户预留，当前单租户不映射（DB 中可空，validate 通过）。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_user_leader")
public class SysUserLeader {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "leader_id", nullable = false)
    private Long leaderId;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder;
}
