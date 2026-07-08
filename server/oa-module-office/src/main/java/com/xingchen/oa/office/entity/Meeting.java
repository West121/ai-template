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
 * 会议预订。库中 status 为 BOOKED / CANCELED，
 * UPCOMING / ONGOING / FINISHED 由日期时段与当前时间比较得出。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_meeting")
public class Meeting {

    public static final String STATUS_BOOKED = "BOOKED";
    public static final String STATUS_CANCELED = "CANCELED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "room_id", nullable = false)
    private Long roomId;

    @Column(nullable = false, length = 128)
    private String subject;

    @Column(name = "meeting_date", nullable = false)
    private LocalDate meetingDate;

    @Column(name = "start_hour", nullable = false)
    private Integer startHour;

    @Column(name = "end_hour", nullable = false)
    private Integer endHour;

    @Column(length = 64)
    private String organizer;

    @Column(name = "organizer_id")
    private Long organizerId;

    /**
     * 参会人用户 id，逗号分隔，如 "1,3"。
     */
    @Column(name = "attendee_ids", nullable = false, length = 255)
    private String attendeeIds = "";

    @Column(nullable = false, length = 16)
    private String status = STATUS_BOOKED;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
