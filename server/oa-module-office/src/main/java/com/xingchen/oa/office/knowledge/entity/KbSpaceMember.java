package com.xingchen.oa.office.knowledge.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * 空间成员权限（ai-knowledge-base.md §2 kb_space_member）—— 空间级 RBAC。
 * principal_type 对应 sys_* 主键：USER(用户) / DEPT(部门) / ROLE(角色)；
 * role：VIEWER 只读 / EDITOR 可编 / ADMIN 管理。
 */
@Getter
@Setter
@Entity
@Table(name = "kb_space_member")
public class KbSpaceMember {

    public static final String PRINCIPAL_USER = "USER";
    public static final String PRINCIPAL_DEPT = "DEPT";
    public static final String PRINCIPAL_ROLE = "ROLE";

    public static final String ROLE_VIEWER = "VIEWER";
    public static final String ROLE_EDITOR = "EDITOR";
    public static final String ROLE_ADMIN = "ADMIN";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "space_id", nullable = false)
    private Long spaceId;

    @Column(name = "principal_type", nullable = false, length = 8)
    private String principalType;

    @Column(name = "principal_id", nullable = false)
    private Long principalId;

    @Column(nullable = false, length = 8)
    private String role = ROLE_VIEWER;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
