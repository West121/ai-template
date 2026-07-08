package com.xingchen.oa.office.entity;

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

/**
 * 出差申请。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_trip")
public class Trip {

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_WITHDRAWN = "WITHDRAWN";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(length = 64)
    private String applicant;

    @Column(name = "dept_id")
    private Long deptId;

    @Column(nullable = false, length = 128)
    private String destination;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "end_date")
    private LocalDate endDate;

    /**
     * TRAIN / FLIGHT / CAR。
     */
    @Column(length = 16)
    private String transport;

    @Column
    private Double budget;

    @Column(length = 512)
    private String reason;

    @Column(nullable = false, length = 16)
    private String status = STATUS_PENDING;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
