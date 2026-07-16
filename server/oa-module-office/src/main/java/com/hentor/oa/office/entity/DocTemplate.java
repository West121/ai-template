package com.hentor.oa.office.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 红头/正文套版模板。type=HEADER/BODY/FULL；content 含占位符（参考用）。
 * 渲染以 GongwenRenderer 输出丹青 .gw-* class 的 HTML 为准（gongwen-format-spec.md）。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_doc_template")
public class DocTemplate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String code;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(nullable = false, length = 16)
    private String type;

    @Column(name = "issuing_org", length = 128)
    private String issuingOrg;

    @Column(columnDefinition = "text")
    private String content;

    @Column(name = "seal_image_id")
    private Long sealImageId;

    @Column(nullable = false)
    private Boolean enabled;
}
