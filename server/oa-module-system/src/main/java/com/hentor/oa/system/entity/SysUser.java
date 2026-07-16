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

import java.time.LocalDate;
import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@Table(name = "sys_user")
public class SysUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String username;

    @Column(nullable = false)
    private String password;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(length = 64)
    private String dept;

    @Column(length = 64)
    private String post;

    @Column(length = 32)
    private String phone;

    /** 工号，如 XC0001，全局唯一 */
    @Column(name = "emp_no", unique = true, length = 32)
    private String empNo;

    @Column(length = 128)
    private String email;

    /** MALE / FEMALE / UNKNOWN */
    @Column(length = 10)
    private String gender = "UNKNOWN";

    @Column
    private LocalDate birthday;

    /** 入职日期 */
    @Column(name = "hire_date")
    private LocalDate hireDate;

    /** 办公地点，如 "A 座 12F-08" */
    @Column(name = "office_location", length = 64)
    private String officeLocation;

    /** 直属上级用户 id，可空 */
    @Column(name = "leader_id")
    private Long leaderId;

    /** 头像 URL，可空（前端无值时用姓名首字头像） */
    @Column(length = 255)
    private String avatar;

    @Column(length = 255)
    private String remark;

    @Column(nullable = false)
    private Boolean enabled = true;

    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_RESIGNED = "RESIGNED";

    /** 在职状态：ACTIVE / RESIGNED（离职）。默认 ACTIVE，向后兼容。RESIGNED → 禁登录 + token 失效。 */
    @Column(nullable = false, length = 16)
    private String status = STATUS_ACTIVE;

    /** 离职日期（RESIGNED 时记录，可空）。 */
    @Column(name = "resign_date")
    private LocalDate resignDate;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
