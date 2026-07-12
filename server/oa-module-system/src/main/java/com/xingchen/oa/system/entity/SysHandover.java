package com.xingchen.oa.system.entity;

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

/**
 * 交接单（离职/转岗治理，DP2）：from_user_id 交出方 → to_user_id 继任者。
 * type=RESIGN|TRANSFER；status=DRAFT（已扫描待执行）|RUNNING（执行中/部分失败可重试）|DONE（全部完成）。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_handover")
public class SysHandover {

    public static final String TYPE_RESIGN = "RESIGN";
    public static final String TYPE_TRANSFER = "TRANSFER";
    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_RUNNING = "RUNNING";
    public static final String STATUS_DONE = "DONE";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "from_user_id", nullable = false)
    private Long fromUserId;

    /** 继任者（交接单默认继任者，item 可覆盖）。 */
    @Column(name = "to_user_id")
    private Long toUserId;

    @Column(nullable = false, length = 16)
    private String type;

    @Column(length = 512)
    private String reason;

    @Column(nullable = false, length = 16)
    private String status = STATUS_DRAFT;

    @Column(name = "operator_id")
    private Long operatorId;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;
}
