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
import com.xingchen.oa.office.support.SecuritySupport;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 报表目录执行（ai-assistant-design-v2.md §11，批C，替换 AiStatsService/stats_report）：
 * 固定 reportCode + <b>参数白名单</b>（parameter_schema keys 之外 → 400）+ 目录级权限 +
 * 数据权限策略（OFFICE_SCOPE=office SecuritySupport / ALL_OR_SELF / SELF）。
 *
 * <p><b>亮点③ 下钻</b>：参数携带 drill_param（如 status=已通过）→ 返回该维度过滤的明细行
 * （>20 行落 ai_dataset，卡片带 datasetId+首页 20 行）；聚合结果 chart 带
 * {@code drill:{reportCode,paramName}}，前端点击类目回调 execute。
 */
@Service
@RequiredArgsConstructor
public class AiReportService {

    /** 卡片内嵌明细上限（§10.4）；超出落数据集。 */
    public static final int INLINE_ROWS = 20;

    private final AiReportCatalogRepository catalogRepository;
    private final ApprovalRepository approvalRepository;
    private final DocumentRepository documentRepository;
    private final AttendanceService attendanceService;
    private final AiDatasetService datasetService;
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
        String drillValue = r.getDrillParam() != null && params.get(r.getDrillParam()) != null
                ? String.valueOf(params.get(r.getDrillParam())) : null;

        return switch (r.getReportCode()) {
            case "APPROVAL_COUNT_BY_STATUS" -> approvalReport(r, user, sessionId, drillValue, false);
            case "APPROVAL_COUNT_BY_TYPE" -> approvalReport(r, user, sessionId, drillValue, true);
            case "APPROVAL_COUNT_BY_PROCESS" -> processReport(r, user, sessionId, drillValue);
            case "DOCUMENT_COUNT_BY_TYPE" -> documentReport(r, user, sessionId, drillValue);
            case "ATTENDANCE_RATE_BY_MONTH" -> attendanceReport(r, str(params.get("month")));
            default -> throw new BusinessException(400, "报表未实现: " + r.getReportCode());
        };
    }

    // ==================== 各报表（数据权限与列表口径一致） ====================

    private ExecResult approvalReport(AiReportCatalog r, UserContext user, Long sessionId,
                                      String drillValue, boolean byType) {
        List<Approval> all = approvalRepository.findAll(SecuritySupport.dataScope("deptId", "applicantId"));
        if (drillValue == null) {
            Map<String, Integer> counts = new LinkedHashMap<>();
            for (Approval a : all) {
                counts.merge(byType ? typeLabel(a.getType()) : statusLabel(a.getStatus()), 1, Integer::sum);
            }
            return aggregate(r, counts);
        }
        // 亮点③ 下钻：标签或原值均可过滤
        String raw = byType ? typeRaw(drillValue) : statusRaw(drillValue);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Approval a : all) {
            String v = byType ? nz(a.getType()) : nz(a.getStatus());
            if (v.equalsIgnoreCase(raw)) {
                rows.add(row("title", a.getTitle(), "type", typeLabel(a.getType()),
                        "status", statusLabel(a.getStatus()), "applicant", a.getApplicant(),
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

    private ExecResult processReport(AiReportCatalog r, UserContext user, Long sessionId, String drillValue) {
        // ALL_OR_SELF：数据权限 ALL 全量，否则仅本人发起（目录 data_scope_strategy 声明口径）
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
            return aggregate(r, counts);
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
            return aggregate(r, counts);
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
        return aggregate(r, counts);
    }

    // ==================== 组装 ====================

    private ExecResult aggregate(AiReportCatalog r, Map<String, Integer> counts) {
        Map<String, Object> drill = null;
        if (StringUtils.hasText(r.getDrillParam())) {
            drill = Map.of("reportCode", r.getReportCode(), "paramName", r.getDrillParam());
        }
        return new ExecResult(r.getReportCode(), r.getName(), false, r.getChartType(),
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

    private String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private String nz(String s) {
        return s == null ? "" : s;
    }
}
