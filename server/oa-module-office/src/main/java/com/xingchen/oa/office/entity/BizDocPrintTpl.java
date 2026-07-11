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

/**
 * 套打模板（BizDoc §4 / §11 独立化）：content=元素树 JSON（mm 坐标；前端设计器/打印渲染器同源渲染）。
 * §11：模板可独立绑定 BIZDOC(def_id) / FLOW(bind_code=wf defCode) / FORM(bind_code=formCode)，
 * 在流程实例上打印；status DRAFT/PUBLISHED，version 发布自增。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_bizdoc_print_tpl")
public class BizDocPrintTpl {

    public static final String BIND_BIZDOC = "BIZDOC";
    public static final String BIND_FLOW = "FLOW";
    public static final String BIND_FORM = "FORM";
    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_PUBLISHED = "PUBLISHED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** BIZDOC 绑定时的单据定义 id；FLOW/FORM 独立模板为空。 */
    @Column(name = "def_id")
    private Long defId;

    @Column(nullable = false, length = 64)
    private String code;

    @Column(name = "bind_type", nullable = false, length = 16)
    private String bindType = BIND_BIZDOC;

    /** FLOW=wf defCode / FORM=formCode；BIZDOC 空（用 defId）。 */
    @Column(name = "bind_code", length = 64)
    private String bindCode;

    @Column(length = 64)
    private String category;

    @Column(length = 255)
    private String description;

    @Column(nullable = false, length = 16)
    private String status = STATUS_PUBLISHED;

    /** 发布自增；DRAFT 新建=0，首次发布→1。 */
    @Column(nullable = false)
    private Integer version = 1;

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

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
