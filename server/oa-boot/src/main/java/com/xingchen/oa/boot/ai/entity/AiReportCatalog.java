package com.xingchen.oa.boot.ai.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 报表目录（ai-assistant-design-v2.md §11.1）：固定 reportCode + 参数白名单（parameter_schema keys）+
 * 权限 + 数据权限策略。替换通用 stats_report——禁止其演变成隐形 SQL 工具。
 */
@Getter
@Setter
@Entity
@Table(name = "ai_report_catalog")
public class AiReportCatalog {

    public static final String STATUS_PUBLISHED = "PUBLISHED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "report_code", nullable = false, length = 64, unique = true)
    private String reportCode;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(length = 255)
    private String description;

    /** JSON {param:{type,description}}；键集即参数白名单。 */
    @Column(name = "parameter_schema", columnDefinition = "text")
    private String parameterSchema;

    @Column(name = "required_authorities", length = 255)
    private String requiredAuthorities;

    /** OFFICE_SCOPE（office 数据权限 Specification）/ ALL_OR_SELF / SELF。 */
    @Column(name = "data_scope_strategy", nullable = false, length = 32)
    private String dataScopeStrategy = "OFFICE_SCOPE";

    /** 多维数据源标识（APPROVAL/DOCUMENT/ATTENDANCE）：execute 按此路由到预定义分组逻辑。 */
    @Column(name = "data_source", length = 32)
    private String dataSource;

    /** 逗号分隔的维度白名单（如 status,type,process,month,dept,initiator）——受控灵活维度的核心。 */
    @Column(name = "allowed_dimensions", length = 255)
    private String allowedDimensions;

    /** 缺省维度（调用方未指定 dimension 时使用；预设别名即其单一维度）。 */
    @Column(name = "default_dimension", length = 32)
    private String defaultDimension;

    /** 逗号分隔的时间粒度白名单（day,week,month,quarter,year）——仅时间维生效。 */
    @Column(name = "allowed_time_grains", length = 128)
    private String allowedTimeGrains;

    @Column(name = "allowed_metrics", length = 255)
    private String allowedMetrics;

    @Column(name = "max_date_range")
    private Integer maxDateRange;

    @Column(name = "max_rows", nullable = false)
    private Integer maxRows = 500;

    @Column(name = "supports_chart", nullable = false)
    private Boolean supportsChart = true;

    @Column(name = "supports_export", nullable = false)
    private Boolean supportsExport = false;

    @Column(name = "chart_type", nullable = false, length = 16)
    private String chartType = "bar";

    /** 亮点③：下钻参数名（chart 卡 drill.paramName；空=不支持下钻）。 */
    @Column(name = "drill_param", length = 32)
    private String drillParam;

    @Column(nullable = false, length = 16)
    private String status = STATUS_PUBLISHED;

    @Column(nullable = false)
    private Integer version = 1;
}
