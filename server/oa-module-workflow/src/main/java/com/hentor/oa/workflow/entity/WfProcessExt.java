package com.hentor.oa.workflow.entity;

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

@Getter
@Setter
@Entity
@Table(name = "wf_process_ext")
public class WfProcessExt {

    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_PUBLISHED = "PUBLISHED";
    public static final String STATUS_DISABLED = "DISABLED";

    public static final String TYPE_DINGTALK = "DINGTALK";
    public static final String TYPE_BPMN = "BPMN";
    /** 图直译：前端归一化 ProcessModel JSON（存 designer_json），发布时经 GraphToBpmnConverter 转 BpmnModel。 */
    public static final String TYPE_GRAPH = "GRAPH";

    /**
     * 表单类型（收敛术语）：ONLINE=在线设计器表单（字段从 schemaJson 派生）/ CODE=代码手写表单（字段从登记清单取，可带 formSubmitPath）。
     * 旧值 DYNAMIC/CUSTOM 保留兼容读取：DYNAMIC→ONLINE、CUSTOM→CODE，见 {@link #canonicalFormType}。
     */
    public static final String FORM_ONLINE = "ONLINE";
    public static final String FORM_CODE = "CODE";
    // 旧术语（存量兼容；新写入统一用 ONLINE/CODE）
    public static final String FORM_DYNAMIC = "DYNAMIC";
    public static final String FORM_CUSTOM = "CUSTOM";

    /** 归一化表单类型为 ONLINE|CODE（旧 DYNAMIC→ONLINE、旧 CUSTOM→CODE；空缺省 ONLINE）。 */
    public static String canonicalFormType(String raw) {
        if (raw == null || raw.isBlank()) {
            return FORM_ONLINE;
        }
        return switch (raw.trim().toUpperCase()) {
            case FORM_CODE, FORM_CUSTOM -> FORM_CODE;
            default -> FORM_ONLINE; // ONLINE / DYNAMIC / 其它
        };
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "def_code", nullable = false, unique = true, length = 64)
    private String defCode;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(length = 64)
    private String category;

    @Column(length = 64)
    private String icon;

    @Column(name = "form_code", length = 64)
    private String formCode;

    @Column(name = "form_version")
    private Integer formVersion;

    /** 表单类型 DYNAMIC / CUSTOM，默认动态表单。 */
    @Column(name = "form_type", nullable = false, length = 20)
    private String formType = FORM_DYNAMIC;

    /** CUSTOM 表单发起页 React 路由。 */
    @Column(name = "form_submit_path", length = 255)
    private String formSubmitPath;

    /** CUSTOM 表单详情查看 React 路由。 */
    @Column(name = "form_view_path", length = 255)
    private String formViewPath;

    /** 流程级配置 JSON（流程操作开关/启动权限/时限/安全）。 */
    @Column(name = "flow_config", columnDefinition = "text")
    private String flowConfig;

    @Column(name = "designer_type", nullable = false, length = 20)
    private String designerType = TYPE_DINGTALK;

    @Column(name = "designer_json", columnDefinition = "text")
    private String designerJson;

    @Column(name = "bpmn_xml", columnDefinition = "text")
    private String bpmnXml;

    @Column(name = "latest_deployment_id", length = 64)
    private String latestDeploymentId;

    @Column(name = "process_definition_id", length = 128)
    private String processDefinitionId;

    @Column(nullable = false, length = 20)
    private String status = STATUS_DRAFT;

    @Column(length = 255)
    private String remark;

    @Column(name = "created_by")
    private Long createdBy;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
