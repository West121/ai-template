package com.xingchen.oa.office.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 会议室。库中 status 仅 FREE / MAINTAIN，BUSY 由运行时按当日预订计算。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_meeting_room")
public class MeetingRoom {

    public static final String STATUS_FREE = "FREE";
    public static final String STATUS_BUSY = "BUSY";
    public static final String STATUS_MAINTAIN = "MAINTAIN";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(length = 16)
    private String floor;

    @Column
    private Integer capacity;

    /**
     * 设备列表，逗号分隔，如 "投屏,白板"。
     */
    @Column(length = 255)
    private String devices;

    @Column(nullable = false, length = 16)
    private String status = STATUS_FREE;
}
