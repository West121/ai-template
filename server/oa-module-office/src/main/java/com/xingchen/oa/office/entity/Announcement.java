package com.xingchen.oa.office.entity;

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
 * 公告：NOTICE 通知 / RULE 制度 / NEWS 动态。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_announcement")
public class Announcement {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 16)
    private String category;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(columnDefinition = "text")
    private String content;

    @Column(length = 64)
    private String publisher;

    @Column(name = "publisher_id")
    private Long publisherId;

    @Column(name = "dept_id")
    private Long deptId;

    @Column(nullable = false)
    private Boolean top = false;

    @Column(nullable = false)
    private Integer reads = 0;

    @Column(name = "publish_at", nullable = false)
    private LocalDateTime publishAt;
}
