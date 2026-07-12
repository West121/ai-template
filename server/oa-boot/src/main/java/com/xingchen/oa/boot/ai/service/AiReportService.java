package com.xingchen.oa.boot.ai.service;

import com.xingchen.oa.boot.ai.entity.AiReportCatalog;
import com.xingchen.oa.boot.ai.repository.AiReportCatalogRepository;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.entity.Approval;
import com.xingchen.oa.office.entity.Document;
import com.xingchen.oa.office.repository.ApprovalRepository;
import com.xingchen.oa.office.repository.DocumentRepository;
import com.xingchen.oa.office.service.AttendanceService;
import com.xingchen.oa.office.support.DeptNameResolver;
import com.xingchen.oa.office.support.SecuritySupport;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.WeekFields;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * 报表目录执行（ai-assistant-design-v2.md §11，批C/批E）。
 *
 * <p><b>受控灵活维度</b>（批E，解决「报表太死板」）：审批量不再是「一个 reportCode 一个写死维度」，
 * 而是合并为一个多维数据源 {@code APPROVAL_COUNT}，声明 {@code allowed_dimensions}
 * （status/type/process/month/dept/initiator）+ {@code allowed_time_grains}（day/week/month/quarter/year）。
 * 调用方在<b>白名单内</b>自由挑维度，后端把维度名映射到<b>预定义</b>的安全分组逻辑
 * （用 JPA {@code Specification}（数据权限）+ Java 分组，或参数化 native 查询），
 * <b>绝不把 LLM 传入的字符串拼进 SQL 字段名/片段</b>——这是「不让 stats_report 演变成隐形 SQL」红线的落地。
 * 非白名单维度 → 友好错误（列出该报表支持的维度），供 AI 改用合法维度重试。
 * 旧 3 个 reportCode（BY_STATUS/BY_TYPE/BY_PROCESS）保留为<b>预设别名</b>（单维白名单，向后兼容原结果）。
 *
 * <p><b>目录级白名单</b>：参数键仍限定在 parameter_schema keys 之内（键外 → 400）；数据权限策略
 * （OFFICE_SCOPE=office SecuritySupport / ALL_OR_SELF / SELF）。
 *
 * <p><b>亮点③ 下钻</b>：携带 drill 参数（聚合类目值）→ 返回该维度过滤的明细行
 * （>20 行落 ai_dataset，卡片带 datasetId+首页 20 行）；聚合结果 chart 带
 * {@code drill:{reportCode,paramName[,dimension]}}，前端点击类目回调 execute。
 */
@Service
@RequiredArgsConstructor
public class AiReportService {

    /** 卡片内嵌明细上限（§10.4）；超出落数据集。 */
    public static final int INLINE_ROWS = 20;

    /** 维度码 → 中文标签（友好错误 / 目录描述 / 卡片标题）。 */
    private static final Map<String, String> DIMENSION_LABELS = Map.of(
            "status", "状态", "type", "类型", "process", "流程",
            "month", "月份", "dept", "部门", "initiator", "发起人", "docType", "文种");

    private final AiReportCatalogRepository catalogRepository;
    private final ApprovalRepository approvalRepository;
    private final DocumentRepository documentRepository;
    private final AttendanceService attendanceService;
    private final AiDatasetService datasetService;
    private final DeptNameResolver deptNameResolver;
    private final ObjectMapper objectMapper;

    @PersistenceContext
    private EntityManager entityManager;

    /** 执行结果：聚合（chartType/categories/data/drill）或明细（columns/rows/total/datasetId）。 */
    public record ExecResult(String reportCode, String title, boolean detail,
                             String chartType, List<String> categories, List<Number> data,
                             List<Map<String, String>> columns, List<Map<String, Object>> rows,
                             Integer total, Long datasetId, Map<String, Object> drill) {
    }

    // ==================== 目录 ====================

    public List<AiReportCatalog> search(String keyword) {
        List<AiReportCatalog> out = new ArrayList<>();
        for (AiReportCatalog r : catalogRepository.findByStatusOrderByIdAsc(AiReportCatalog.STATUS_PUBLISHED)) {
            if (!StringUtils.hasText(keyword)
                    || r.getName().contains(keyword) || r.getReportCode().toLowerCase().contains(keyword.toLowerCase())
                    || (r.getDescription() != null && r.getDescription().contains(keyword))) {
                out.add(r);
            }
        }
        return out;
    }

    public AiReportCatalog require(String reportCode) {
        return catalogRepository.findByReportCodeIgnoreCase(reportCode == null ? "" : reportCode.trim())
                .filter(r -> AiReportCatalog.STATUS_PUBLISHED.equals(r.getStatus()))
                .orElseThrow(() -> new BusinessException(400, "报表不存在: " + reportCode));
    }

    public Map<String, Object> describe(AiReportCatalog r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("reportCode", r.getReportCode());
        m.put("name", r.getName());
        m.put("description", r.getDescription());
        m.put("chartType", r.getChartType());
        m.put("parameterSchema", parse(r.getParameterSchema()));
        m.put("drillParam", r.getDrillParam());
        m.put("dataScopeStrategy", r.getDataScopeStrategy());
        m.put("maxRows", r.getMaxRows());
        m.put("supportsChart", r.getSupportsChart());
        // 受控灵活维度：把可选维度/时间粒度暴露给 AI（AI 据此把「按月份」→dimension=month 等）
        m.put("allowedDimensions", dimensionList(r));
        m.put("allowedTimeGrains", new ArrayList<>(grainSet(r)));
        m.put("defaultDimension", r.getDefaultDimension());
        return m;
    }

    // ==================== 执行 ====================

    /**
     * 执行报表：白名单外参数 400；含 drill 参数 → 明细（>20 行落数据集）；否则聚合。
     * sessionId 可空（API 直调路径）。
     */
    public ExecResult execute(String reportCode, Map<String, Object> parameters,
                              UserContext user, Long sessionId) {
        AiReportCatalog r = require(reportCode);
        // 目录级权限（工具面之外 API 直调也复验）
        if (StringUtils.hasText(r.getRequiredAuthorities()) && user.getPermissions() != null) {
            for (String a : r.getRequiredAuthorities().split(",")) {
                if (StringUtils.hasText(a) && !user.getPermissions().contains(a.trim())) {
                    throw new BusinessException(403, "缺少报表权限: " + a.trim());
                }
            }
        }
        // §11.1 参数白名单：parameter_schema keys 之外一律 400（不做任何"聪明"透传）
        Map<String, Object> params = parameters == null ? Map.of() : parameters;
        Set<String> allowed = schemaKeys(r.getParameterSchema());
        for (String key : params.keySet()) {
            if (!allowed.contains(key)) {
                throw new BusinessException(400, "参数不在白名单: " + key + "（允许: " + allowed + "）");
            }
        }

        // 按数据源路由到预定义分组逻辑（缺省从 reportCode 前缀兜底，保证迁移前后都稳）
        return switch (dataSourceOf(r)) {
            case "APPROVAL" -> approvalDataSource(r, params, user, sessionId);
            case "DOCUMENT" -> documentReport(r, user, sessionId, drillValueOf(r, params));
            case "ATTENDANCE" -> attendanceReport(r, str(params.get("month")));
            default -> throw new BusinessException(400, "报表未实现: " + r.getReportCode());
        };
    }

    /** 数据源（显式列优先，缺省从 reportCode 前缀推断——迁移数据缺失也不崩）。 */
    private String dataSourceOf(AiReportCatalog r) {
        if (StringUtils.hasText(r.getDataSource())) {
            return r.getDataSource().trim().toUpperCase();
        }
        String code = r.getReportCode() == null ? "" : r.getReportCode().toUpperCase();
        if (code.startsWith("APPROVAL")) {
            return "APPROVAL";
        }
        if (code.startsWith("DOCUMENT")) {
            return "DOCUMENT";
        }
        if (code.startsWith("ATTENDANCE")) {
            return "ATTENDANCE";
        }
        return "";
    }

    // ==================== APPROVAL 多维数据源（受控灵活维度） ====================

    /**
     * 审批量数据源：维度在 allowed_dimensions 白名单内选择，映射到预定义分组逻辑。
     * <ul>
     *   <li>status/type/month/dept/initiator：走 oa_approval + {@code SecuritySupport.dataScope}
     *       （数据权限口径与列表一致），在 Java 内按预定义 bucket 分组——<b>不涉及任何 SQL 字符串拼接</b>；</li>
     *   <li>process：走 wf_instance_ext 参数化 native 查询（ALL_OR_SELF），字段/条件均为常量，仅 uid 绑定。</li>
     * </ul>
     */
    private ExecResult approvalDataSource(AiReportCatalog r, Map<String, Object> params,
                                          UserContext user, Long sessionId) {
        String dimension = resolveDimension(r, params);
        String drillValue = drillValueOf(r, params);
        if ("process".equals(dimension)) {
            return processDimension(r, user, sessionId, drillValue);
        }

        String timeGrain = resolveTimeGrain(r, params);
        LocalDate[] range = resolveRange(params);
        Map<Long, String> deptNames = "dept".equals(dimension) ? deptNameResolver.nameMap() : Map.of();
        // 数据权限 Specification（部门 + 归属人）——员工只见本人范围，管理员见全部
        List<Approval> all = approvalRepository.findAll(SecuritySupport.dataScope("deptId", "applicantId"));

        if (drillValue == null) {
            // 时间维用 TreeMap 保证类目按时间升序（折线/柱状可读）；分类维保持出现顺序
            Map<String, Integer> counts = "month".equals(dimension)
                    ? new TreeMap<>() : new LinkedHashMap<>();
            for (Approval a : all) {
                if (!inRange(a.getCreatedAt(), range)) {
                    continue;
                }
                counts.merge(bucketKey(dimension, a, timeGrain, deptNames), 1, Integer::sum);
            }
            return aggregate(r, dimension, counts);
        }

        // 亮点③ 下钻：按当前维度的某类目值过滤明细（drillValue 归一到 bucket 空间后精确比对）
        String target = normalizeDrill(dimension, drillValue);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Approval a : all) {
            if (!inRange(a.getCreatedAt(), range)) {
                continue;
            }
            if (bucketKey(dimension, a, timeGrain, deptNames).equalsIgnoreCase(target)) {
                rows.add(row("title", nz(a.getTitle()), "type", typeLabel(a.getType()),
                        "status", statusLabel(a.getStatus()), "applicant", nz(a.getApplicant()),
                        "createdAt", String.valueOf(a.getCreatedAt())));
            }
            if (rows.size() >= r.getMaxRows()) {
                break;
            }
        }
        List<Map<String, String>> columns = cols("title", "标题", "type", "类型",
                "status", "状态", "applicant", "申请人", "createdAt", "创建时间");
        return detail(r, user, sessionId, columns, rows);
    }

    /** process 维度：wf_instance_ext 按流程定义聚合（ALL_OR_SELF；下钻按流程名过滤实例明细）。 */
    private ExecResult processDimension(AiReportCatalog r, UserContext user, Long sessionId, String drillValue) {
        boolean all = user.getDataScope() != null && user.getDataScope().all();
        String scopeSql = all ? "" : "AND initiator_id = :uid ";
        if (drillValue == null) {
            var q = entityManager.createNativeQuery(
                    "SELECT def_name, count(*) FROM wf_instance_ext WHERE def_name IS NOT NULL "
                            + scopeSql + "GROUP BY def_name ORDER BY count(*) DESC LIMIT 50");
            if (!all) {
                q.setParameter("uid", user.getUserId());
            }
            Map<String, Integer> counts = new LinkedHashMap<>();
            for (Object rowObj : q.getResultList()) {
                Object[] cells = (Object[]) rowObj;
                counts.put(String.valueOf(cells[0]), ((Number) cells[1]).intValue());
            }
            return aggregate(r, "process", counts);
        }
        var q = entityManager.createNativeQuery(
                "SELECT title, def_name, initiator_name, biz_status FROM wf_instance_ext "
                        + "WHERE def_name = :dn " + scopeSql + "ORDER BY id DESC LIMIT " + r.getMaxRows());
        q.setParameter("dn", drillValue);
        if (!all) {
            q.setParameter("uid", user.getUserId());
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Object rowObj : q.getResultList()) {
            Object[] c = (Object[]) rowObj;
            rows.add(row("title", str(c[0]), "defName", str(c[1]),
                    "initiatorName", str(c[2]), "bizStatus", str(c[3])));
        }
        return detail(r, user, sessionId,
                cols("title", "标题", "defName", "流程", "initiatorName", "发起人", "bizStatus", "状态"), rows);
    }

    private ExecResult documentReport(AiReportCatalog r, UserContext user, Long sessionId, String drillValue) {
        List<Document> all = documentRepository.findAll(SecuritySupport.dataScope("deptId", "creatorId"));
        if (drillValue == null) {
            Map<String, Integer> counts = new LinkedHashMap<>();
            for (Document d : all) {
                counts.merge(d.getDocType() == null ? "未分类" : d.getDocType(), 1, Integer::sum);
            }
            return aggregate(r, "docType", counts);
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Document d : all) {
            String t = d.getDocType() == null ? "未分类" : d.getDocType();
            if (t.equalsIgnoreCase(drillValue)) {
                rows.add(row("code", nz(d.getCode()), "title", nz(d.getTitle()),
                        "docType", t, "status", nz(d.getStatus())));
            }
            if (rows.size() >= r.getMaxRows()) {
                break;
            }
        }
        return detail(r, user, sessionId,
                cols("code", "文号", "title", "标题", "docType", "文种", "status", "状态"), rows);
    }

    private ExecResult attendanceReport(AiReportCatalog r, String month) {
        var resp = attendanceService.records(month); // SELF：服务本身按当前用户
        var s = resp.summary();
        Map<String, Integer> counts = new LinkedHashMap<>();
        counts.put("出勤天数", (int) s.days());
        counts.put("迟到", (int) s.late());
        counts.put("早退", (int) s.early());
        counts.put("缺勤", (int) s.absent());
        return aggregate(r, "attendance", counts);
    }

    // ==================== 维度 / 时间粒度 / 范围解析（白名单校验） ====================

    /** 维度：请求优先，缺省 default_dimension；必须落在 allowed_dimensions 白名单内，否则友好 400。 */
    private String resolveDimension(AiReportCatalog r, Map<String, Object> params) {
        Set<String> allowedDims = dimensionSet(r);
        String requested = str(params.get("dimension"));
        String dim = StringUtils.hasText(requested)
                ? requested.trim().toLowerCase()
                : (StringUtils.hasText(r.getDefaultDimension())
                ? r.getDefaultDimension().trim().toLowerCase()
                : (allowedDims.isEmpty() ? null : allowedDims.iterator().next()));
        if (dim == null || !allowedDims.contains(dim)) {
            throw new BusinessException(400, friendlyDimError(r, requested, allowedDims));
        }
        return dim;
    }

    /** 友好错误：列出该报表支持的维度（中文标签 + 码），让 AI 能改用合法维度重试。 */
    private String friendlyDimError(AiReportCatalog r, String requested, Set<String> allowedDims) {
        StringBuilder sb = new StringBuilder("报表[").append(r.getReportCode()).append("]不支持维度[")
                .append(StringUtils.hasText(requested) ? requested : "(未指定)").append("]。支持的维度：");
        List<String> parts = new ArrayList<>();
        for (String d : allowedDims) {
            parts.add(DIMENSION_LABELS.getOrDefault(d, d) + "(" + d + ")");
        }
        return sb.append(String.join("、", parts)).toString();
    }

    /** 时间粒度：仅时间维生效；请求需在 allowed_time_grains 内，缺省 month。 */
    private String resolveTimeGrain(AiReportCatalog r, Map<String, Object> params) {
        String requested = str(params.get("timeGrain"));
        if (!StringUtils.hasText(requested)) {
            return "month";
        }
        String g = requested.trim().toLowerCase();
        Set<String> grains = grainSet(r);
        if (!grains.isEmpty() && !grains.contains(g)) {
            throw new BusinessException(400, "报表[" + r.getReportCode() + "]不支持时间粒度["
                    + requested + "]。支持：" + grains);
        }
        return g;
    }

    /** 可选创建时间范围 [start, end]（yyyy-MM-dd）；解析失败即视为无界（不抛错，宽松）。 */
    private LocalDate[] resolveRange(Map<String, Object> params) {
        return new LocalDate[]{parseDate(str(params.get("rangeStart"))), parseDate(str(params.get("rangeEnd")))};
    }

    private boolean inRange(LocalDateTime createdAt, LocalDate[] range) {
        if (range == null || (range[0] == null && range[1] == null) || createdAt == null) {
            return true;
        }
        LocalDate d = createdAt.toLocalDate();
        if (range[0] != null && d.isBefore(range[0])) {
            return false;
        }
        return range[1] == null || !d.isAfter(range[1]);
    }

    // ==================== 预定义 bucket（维度 → 分组键；无 SQL 拼接） ====================

    /** 维度 → 该审批单的分组键（switch 常量分支，LLM 的 dimension 字符串只挑分支，不进 SQL）。 */
    private String bucketKey(String dimension, Approval a, String timeGrain, Map<Long, String> deptNames) {
        return switch (dimension) {
            case "status" -> statusLabel(a.getStatus());
            case "type" -> typeLabel(a.getType());
            case "dept" -> a.getDeptId() == null ? "未分配部门"
                    : deptNames.getOrDefault(a.getDeptId(), "部门#" + a.getDeptId());
            case "initiator" -> StringUtils.hasText(a.getApplicant()) ? a.getApplicant() : "未知";
            case "month" -> timeBucket(a.getCreatedAt(), timeGrain);
            default -> "其它";
        };
    }

    /** 按时间粒度归一（升序可比的字符串键）。 */
    private String timeBucket(LocalDateTime t, String grain) {
        if (t == null) {
            return "未知";
        }
        LocalDate d = t.toLocalDate();
        return switch (grain) {
            case "day" -> d.toString(); // yyyy-MM-dd
            case "week" -> {
                WeekFields wf = WeekFields.ISO;
                yield String.format("%04d-W%02d", d.get(wf.weekBasedYear()), d.get(wf.weekOfWeekBasedYear()));
            }
            case "quarter" -> d.getYear() + "-Q" + ((d.getMonthValue() - 1) / 3 + 1);
            case "year" -> String.valueOf(d.getYear());
            default -> String.format("%04d-%02d", d.getYear(), d.getMonthValue()); // month
        };
    }

    /** 下钻值归一到 bucket 空间：status/type 兼容中文标签或原码；其余按类目值直比。 */
    private String normalizeDrill(String dimension, String drillValue) {
        return switch (dimension) {
            case "status" -> statusLabel(statusRaw(drillValue));
            case "type" -> typeLabel(typeRaw(drillValue));
            default -> drillValue;
        };
    }

    // ==================== 组装 ====================

    private ExecResult aggregate(AiReportCatalog r, String dimension, Map<String, Integer> counts) {
        Map<String, Object> drill = null;
        if (StringUtils.hasText(r.getDrillParam())) {
            drill = new LinkedHashMap<>();
            drill.put("reportCode", r.getReportCode());
            drill.put("paramName", r.getDrillParam());
            if (isFlexible(r)) {
                drill.put("dimension", dimension); // 灵活报表：下钻回调需带回当前维度
            }
        }
        return new ExecResult(r.getReportCode(), titleFor(r, dimension), false,
                chartTypeFor(dimension, r.getChartType()),
                new ArrayList<>(counts.keySet()),
                new ArrayList<Number>(counts.values()),
                null, null, null, null, drill);
    }

    /** 明细：>INLINE_ROWS 落数据集（§11.2），返回首页 + datasetId + total。 */
    private ExecResult detail(AiReportCatalog r, UserContext user, Long sessionId,
                              List<Map<String, String>> columns, List<Map<String, Object>> rows) {
        Long datasetId = null;
        List<Map<String, Object>> inline = rows;
        if (rows.size() > INLINE_ROWS) {
            datasetId = datasetService.create(user.getUserId(), sessionId, r.getReportCode(), columns, rows);
            inline = new ArrayList<>(rows.subList(0, INLINE_ROWS));
        }
        return new ExecResult(r.getReportCode(), r.getName() + " - 明细", true, null, null, null,
                columns, inline, rows.size(), datasetId, null);
    }

    /** 图表类型按维度合理默认（时间维→折线；状态→饼；其余分类维→柱状；未知回退目录配置）。 */
    private String chartTypeFor(String dimension, String fallback) {
        return switch (dimension) {
            case "month" -> "line";
            case "status" -> "pie";
            case "type", "dept", "process", "initiator" -> "bar";
            default -> StringUtils.hasText(fallback) ? fallback : "bar";
        };
    }

    /** 灵活报表（多维白名单，>1 维）标题带上当前维度；预设别名保持原名（向后兼容）。 */
    private String titleFor(AiReportCatalog r, String dimension) {
        if (!isFlexible(r)) {
            return r.getName();
        }
        return r.getName() + "(按" + DIMENSION_LABELS.getOrDefault(dimension, dimension) + ")";
    }

    private boolean isFlexible(AiReportCatalog r) {
        return dimensionSet(r).size() > 1;
    }

    // ==================== 白名单解析 ====================

    private Set<String> dimensionSet(AiReportCatalog r) {
        return csvSet(r.getAllowedDimensions());
    }

    private Set<String> grainSet(AiReportCatalog r) {
        return csvSet(r.getAllowedTimeGrains());
    }

    private Set<String> csvSet(String csv) {
        Set<String> out = new LinkedHashSet<>();
        if (StringUtils.hasText(csv)) {
            for (String s : csv.split(",")) {
                if (StringUtils.hasText(s)) {
                    out.add(s.trim().toLowerCase());
                }
            }
        }
        return out;
    }

    private List<Map<String, String>> dimensionList(AiReportCatalog r) {
        List<Map<String, String>> out = new ArrayList<>();
        for (String d : dimensionSet(r)) {
            out.add(Map.of("code", d, "label", DIMENSION_LABELS.getOrDefault(d, d)));
        }
        return out;
    }

    /** 下钻参数值：drill_param 命名的参数（灵活报表=drillValue，别名=status/type/processName…）。 */
    private String drillValueOf(AiReportCatalog r, Map<String, Object> params) {
        if (!StringUtils.hasText(r.getDrillParam())) {
            return null;
        }
        Object v = params.get(r.getDrillParam());
        return v == null ? null : String.valueOf(v);
    }

    private Set<String> schemaKeys(String parameterSchema) {
        Set<String> keys = new LinkedHashSet<>();
        JsonNode node = parse(parameterSchema);
        if (node != null && node.isObject()) {
            node.properties().forEach(e -> keys.add(e.getKey()));
        }
        return keys;
    }

    // ==================== 标签映射（V1 口径；下钻接受标签或原值） ====================

    private String statusLabel(String status) {
        return switch (nz(status)) {
            case "PENDING" -> "待审批";
            case "APPROVED" -> "已通过";
            case "REJECTED" -> "已驳回";
            case "WITHDRAWN" -> "已撤回";
            default -> status == null ? "其它" : status;
        };
    }

    private String statusRaw(String v) {
        return switch (nz(v)) {
            case "待审批" -> "PENDING";
            case "已通过" -> "APPROVED";
            case "已驳回" -> "REJECTED";
            case "已撤回" -> "WITHDRAWN";
            default -> v;
        };
    }

    private String typeLabel(String type) {
        return switch (nz(type)) {
            case "LEAVE" -> "请假";
            case "TRIP" -> "出差";
            case "EXPENSE" -> "报销";
            case "OVERTIME" -> "加班";
            default -> type == null ? "其它" : type;
        };
    }

    private String typeRaw(String v) {
        return switch (nz(v)) {
            case "请假" -> "LEAVE";
            case "出差" -> "TRIP";
            case "报销" -> "EXPENSE";
            case "加班" -> "OVERTIME";
            default -> v;
        };
    }

    // ==================== 工具 ====================

    private Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            m.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return m;
    }

    private List<Map<String, String>> cols(String... kv) {
        List<Map<String, String>> out = new ArrayList<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            out.add(Map.of("key", kv[i], "label", kv[i + 1]));
        }
        return out;
    }

    private JsonNode parse(String json) {
        try {
            return StringUtils.hasText(json) ? objectMapper.readTree(json) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private LocalDate parseDate(String s) {
        try {
            return StringUtils.hasText(s) ? LocalDate.parse(s.trim()) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private String nz(String s) {
        return s == null ? "" : s;
    }
}
