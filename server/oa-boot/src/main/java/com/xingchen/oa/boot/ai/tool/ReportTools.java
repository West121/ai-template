package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.entity.AiReportCatalog;
import com.xingchen.oa.boot.ai.service.AiReportService;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 报表工具（批C，§11 替换 stats_report）：report_search / report_describe / report_execute。
 * 固定 reportCode 目录制——参数白名单 + 目录权限 + 数据权限策略在 {@link AiReportService}；
 * 旧 stats_report(module,dimension) 经别名 + 入参映射过渡。
 * 亮点③：聚合 chart 卡带 drill:{reportCode,paramName}；下钻明细 >20 行落 ai_dataset（卡带 datasetId）。
 * 亮点④：结果带 REPORT 引用。
 */
@Component
@RequiredArgsConstructor
public class ReportTools {

    private final AiToolSupport support;
    private final AiReportService reportService;
    private final AiSessionHolder sessionHolder;

    @AiToolDefinition(name = "report_search",
            description = "按关键词搜索可用统计报表目录（reportCode/名称/说明）。参数 keyword 可选。",
            paramsSchema = "{\"keyword\":{\"type\":\"string\",\"description\":\"可选，报表名称或说明关键词\"}}")
    public ToolResult reportSearch(Map<String, Object> args) {
        List<AiReportCatalog> hits = reportService.search(str(args.get("keyword")));
        List<Map<String, Object>> items = new ArrayList<>();
        List<Map<String, Object>> citations = new ArrayList<>();
        for (AiReportCatalog r : hits) {
            items.add(Map.of("reportCode", r.getReportCode(), "name", r.getName(),
                    "description", nz(r.getDescription())));
            citations.add(ToolResult.citation("REPORT", r.getReportCode(), r.getName()));
        }
        return ToolResult.of(support.toJson(Map.of("reports", items))).withCitations(citations);
    }

    @AiToolDefinition(name = "report_describe",
            description = "查看某报表的参数说明与下钻能力。参数 reportCode（可先用 report_search 获取）。",
            paramsSchema = "{\"reportCode\":{\"type\":\"string\",\"description\":\"报表编码，如 APPROVAL_COUNT_BY_STATUS\"}}",
            required = {"reportCode"})
    public ToolResult reportDescribe(Map<String, Object> args) {
        AiReportCatalog r = reportService.require(str(args.get("reportCode")));
        return ToolResult.of(support.toJson(reportService.describe(r)))
                .withCitations(List.of(ToolResult.citation("REPORT", r.getReportCode(), r.getName())));
    }

    @AiToolDefinition(name = "report_execute", aliases = {"stats_report"},
            authorities = {"office:approval:approve"},
            description = "执行统计报表（服务端预置聚合，带数据权限）。参数 reportCode + parameters（键取自 report_describe "
                    + "的 parameterSchema 白名单）。多维报表（如 APPROVAL_COUNT）用 dimension 选统计维度——只能从该报表 "
                    + "allowedDimensions 里选：用户说「按月份」→dimension=month、「按部门」→dept、「按类型」→type、"
                    + "「按状态」→status、「按流程」→process、「按发起人/按人」→initiator；时间维可加 timeGrain"
                    + "（day/week/month/quarter/year）。维度不在白名单会返回「该报表支持的维度」友好错误，据此改用合法维度重试。"
                    + "携带下钻参数（describe.drillParam）时返回明细列表。dimension/timeGrain 便捷参数亦可平铺在顶层。",
            paramsSchema = "{\"reportCode\":{\"type\":\"string\",\"description\":\"报表编码，如 APPROVAL_COUNT\"},"
                    + "\"parameters\":{\"type\":\"object\",\"description\":\"报表参数（白名单内；含下钻参数则返回明细）\"},"
                    + "\"dimension\":{\"type\":\"string\",\"description\":\"统计维度（便捷平铺；从报表 allowedDimensions 选，"
                    + "如 status/type/process/month/dept/initiator）。无 reportCode 时兼容旧 stats_report 选码 status|type|docType\"},"
                    + "\"timeGrain\":{\"type\":\"string\",\"description\":\"时间粒度（仅时间维 month 生效）：day/week/month/quarter/year\"},"
                    + "\"rangeStart\":{\"type\":\"string\",\"description\":\"可选，起始日期 yyyy-MM-dd\"},"
                    + "\"rangeEnd\":{\"type\":\"string\",\"description\":\"可选，结束日期 yyyy-MM-dd\"},"
                    + "\"module\":{\"type\":\"string\",\"description\":\"旧版参数（兼容）：approval|document\"}}")
    @SuppressWarnings("unchecked")
    public ToolResult reportExecute(Map<String, Object> args) {
        // 旧 stats_report(module,dimension) 入参映射（别名过渡期）：无 reportCode 时按 module/dimension 选码
        String reportCode = str(args.get("reportCode"));
        boolean explicit = StringUtils.hasText(reportCode);
        if (!explicit) {
            reportCode = legacyCode(str(args.get("module")), str(args.get("dimension")));
        }
        Map<String, Object> parameters = args.get("parameters") instanceof Map<?, ?> m
                ? new LinkedHashMap<>((Map<String, Object>) m) : new LinkedHashMap<>();
        // 受控灵活维度：顶层便捷参数并入 parameters（仅显式 reportCode 时，避免与旧 dimension 选码语义冲突）
        if (explicit) {
            mergeArg(parameters, "dimension", args.get("dimension"));
            mergeArg(parameters, "timeGrain", args.get("timeGrain"));
            mergeArg(parameters, "rangeStart", args.get("rangeStart"));
            mergeArg(parameters, "rangeEnd", args.get("rangeEnd"));
        }
        AiSessionHolder.Turn turn = sessionHolder.currentTurn();
        AiReportService.ExecResult r = reportService.execute(reportCode, parameters,
                support.currentUser(), turn != null ? turn.sessionId() : null);

        Map<String, Object> card;
        if (r.detail()) {
            card = support.listCard(r.title(), r.columns(), r.rows(), null);
            card.put("total", r.total());
            if (r.datasetId() != null) {
                card.put("datasetId", r.datasetId()); // §11.2：完整数据经 GET /api/ai/datasets/{id}
            }
            return ToolResult.of(support.toJson(Map.of("reportCode", r.reportCode(),
                            "total", r.total(), "rows", r.rows(),
                            "note", r.datasetId() != null ? "超出 20 行已落数据集，完整数据见卡片" : "")), card)
                    .withCitations(List.of(ToolResult.citation("REPORT", r.reportCode(), r.title())));
        }
        card = "pie".equals(r.chartType())
                ? support.chartCard("pie", r.title(), r.categories(), pieSeries(r))
                : support.chartCard(r.chartType(), r.title(), r.categories(),
                List.of(Map.of("name", r.title(), "data", r.data())));
        card.put("reportCode", r.reportCode());
        if (r.drill() != null) {
            card.put("drill", r.drill()); // 亮点③：前端点击类目 → POST /api/ai/reports/{code}/execute
        }
        return ToolResult.of(support.toJson(Map.of("reportCode", r.reportCode(), "title", r.title(),
                        "categories", r.categories(), "data", r.data())), card)
                .withCitations(List.of(ToolResult.citation("REPORT", r.reportCode(), r.title())));
    }

    /** 顶层便捷参数并入 parameters：非空且未在 parameters 中显式给出时才补。 */
    private void mergeArg(Map<String, Object> params, String key, Object value) {
        if (value != null && StringUtils.hasText(String.valueOf(value)) && !params.containsKey(key)) {
            params.put(key, value);
        }
    }

    /** 旧 stats_report 入参 → reportCode（V1 兼容口径）。 */
    private String legacyCode(String module, String dimension) {
        String m = module == null ? "" : module.toLowerCase();
        String d = dimension == null ? "" : dimension.toLowerCase();
        return switch (m) {
            case "approval" -> "type".equals(d) ? "APPROVAL_COUNT_BY_TYPE" : "APPROVAL_COUNT_BY_STATUS";
            case "document" -> "DOCUMENT_COUNT_BY_TYPE";
            case "attendance" -> "ATTENDANCE_RATE_BY_MONTH";
            default -> m; // 交给目录校验报 400
        };
    }

    /** pie：series 数据项带 name/value/percent（§10，V1 口径）。 */
    private List<Map<String, Object>> pieSeries(AiReportService.ExecResult r) {
        double total = r.data().stream().mapToDouble(Number::doubleValue).sum();
        List<Map<String, Object>> data = new ArrayList<>();
        for (int i = 0; i < r.categories().size(); i++) {
            double v = r.data().get(i).doubleValue();
            data.add(Map.of("name", r.categories().get(i), "value", v,
                    "percent", total > 0 ? Math.round(v / total * 1000) / 10.0 : 0));
        }
        return List.of(Map.of("name", r.title(), "data", data));
    }

    private String str(Object v) {
        return v == null || !StringUtils.hasText(String.valueOf(v)) ? null : String.valueOf(v).trim();
    }

    private String nz(String s) {
        return s == null ? "" : s;
    }
}
