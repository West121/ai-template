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

import java.time.OffsetDateTime;

/** 套打模板（BizDoc §4）：content=元素树 JSON（mm 坐标；前端设计器/打印渲染器同源渲染）。 */
@Getter
@Setter
@Entity
@Table(name = "oa_bizdoc_print_tpl")
public class BizDocPrintTpl {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "def_id", nullable = false)
    private Long defId;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(nullable = false, length = 8)
    private String paper = "A4";

    @Column(nullable = false)
    private Boolean landscape = false;

    @Column(columnDefinition = "text")
    private String content;

    @Column(name = "is_default", nullable = false)
    private Boolean isDefault = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
