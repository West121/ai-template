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
 * 文号规则：机关代字 + pattern（六角括号）+ 序号周期/宽度。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_doc_number_rule")
public class DocNumberRule {

    public static final String SCOPE_YEAR = "YEAR";
    public static final String SCOPE_MONTH = "MONTH";
    public static final String SCOPE_NONE = "NONE";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String code;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(name = "org_code", nullable = false, length = 64)
    private String orgCode;

    @Column(name = "doc_type", length = 16)
    private String docType;

    @Column(nullable = false, length = 128)
    private String pattern;

    @Column(name = "seq_scope", nullable = false, length = 8)
    private String seqScope;

    @Column(name = "seq_width", nullable = false)
    private Integer seqWidth;

    @Column(nullable = false)
    private Boolean enabled;
}
