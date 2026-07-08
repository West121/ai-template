package com.xingchen.oa.workflow.entity;

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

    /** 表单类型：动态表单（可视化设计器）/ 自定义表单（React 路由页面）。 */
    public static final String FORM_DYNAMIC = "DYNAMIC";
    public static final String FORM_CUSTOM = "CUSTOM";

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
