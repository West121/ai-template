package com.hentor.oa.system.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@Table(name = "sys_dept")
public class SysDept {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(name = "parent_id")
    private Long parentId;

    @Column
    private Integer sort;

    /**
     * 祖先链，如根为 '0'、二级部门为 '0,1'，用于 DEPT_AND_CHILD 数据范围匹配子部门。
     */
    @Column(nullable = false, length = 255)
    private String ancestors = "";

    /**
     * 物化路径（DP1b），含自身，如 '/1/4/12/'。子树查询 `path LIKE '/1/4/%'` 走 text_pattern_ops 索引，
     * 替代 ancestors 递归。与 ancestors 结果一致（并存维护，向后兼容）。
     */
    @Column(length = 512)
    private String path;

    /** 部门编码，如 XC-TECH，全局唯一（uk_sys_dept_code），可空 */
    @Column(unique = true, length = 32)
    private String code;

    /** 部门负责人用户 id，可空 */
    @Column(name = "leader_id")
    private Long leaderId;

    @Column(nullable = false)
    private Boolean enabled = true;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
