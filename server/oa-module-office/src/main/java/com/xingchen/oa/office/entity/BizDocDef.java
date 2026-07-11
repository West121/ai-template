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
 * 单据定义（BizDoc §2）：绑表单（ONLINE/CODE）+ 编号规则（复用 oa_doc_number_rule）+
 * 打印模板 + 可选审批流（wf defCode）。submit_path=CODE 表单运行时「新建」跳转路径。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_bizdoc_def")
public class BizDocDef {

    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_PUBLISHED = "PUBLISHED";
    public static final String STATUS_DISABLED = "DISABLED";

    public static final String FORM_ONLINE = "ONLINE";
    public static final String FORM_CODE = "CODE";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String code;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(length = 64)
    private String category;

    @Column(length = 64)
    private String icon;

    @Column(name = "form_type", nullable = false, length = 16)
    private String formType = FORM_ONLINE;

    @Column(name = "form_code", length = 64)
    private String formCode;

    /** CODE 表单运行时「新建」跳转路径（同公文 form_submit_path 口径，疾风批A契约）。 */
    @Column(name = "submit_path", length = 255)
    private String submitPath;

    /** 空=不占号。 */
    @Column(name = "number_rule_id")
    private Long numberRuleId;

    /** 空=纯台账（提交即生效）。 */
    @Column(name = "wf_def_code", length = 64)
    private String wfDefCode;

    /** {columns:[{field,label,width?}], filters:[{field,label,type}]}。 */
    @Column(name = "list_config", columnDefinition = "text")
    private String listConfig;

    @Column(name = "default_print_tpl_id")
    private Long defaultPrintTplId;

    @Column(nullable = false, length = 16)
    private String status = STATUS_DRAFT;

    @Column(length = 255)
    private String remark;

    @Column(name = "created_by")
    private Long createdBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
