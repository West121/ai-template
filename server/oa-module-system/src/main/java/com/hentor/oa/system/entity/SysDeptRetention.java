package com.hentor.oa.system.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 转岗「旧部门数据保留期」（DP3）：user_id 在 expire_at 前仍可见 dept_id（旧部门）的数据。
 * 过期即自动收敛（查询按 expire_at &gt; now 过滤，无需清理任务）。折入 PermissionService 的部门维可见集。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_dept_retention")
public class SysDeptRetention {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "dept_id", nullable = false)
    private Long deptId;

    @Column(name = "expire_at", nullable = false)
    private LocalDateTime expireAt;
}
