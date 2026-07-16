package com.hentor.oa.office.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

/**
 * 个人日程。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_schedule")
public class Schedule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, length = 128)
    private String title;

    @Column(name = "schedule_date", nullable = false)
    private LocalDate scheduleDate;

    /**
     * HH:mm，如 14:00。
     */
    @Column(name = "start_time", length = 5)
    private String startTime;

    @Column(name = "end_time", length = 5)
    private String endTime;

    @Column(length = 128)
    private String place;

    /**
     * MEETING / REVIEW / TRIP / TRAINING / OTHER。
     */
    @Column(nullable = false, length = 16)
    private String type;
}
