package com.hentor.oa.boot.ai.controller;

import com.hentor.oa.boot.ai.entity.AiReportCatalog;
import com.hentor.oa.boot.ai.service.AiDatasetService;
import com.hentor.oa.boot.ai.service.AiFeatureService;
import com.hentor.oa.boot.ai.service.AiReportService;
import com.hentor.oa.boot.ai.tool.AiToolSupport;
import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.core.R;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AI 目录/报表/数据集 API（V2 批C，§10.2/§11/§12.1）。契约对账（前端 c96b522）：
 * <ul>
 *   <li>GET /api/ai/features —— 当前用户可见功能目录（受控导航来源）；</li>
 *   <li>GET /api/ai/features/{code} —— featureCode 校验（非法 400 / 不可见 403）；</li>
 *   <li>GET /api/ai/reports、/reports/{code} —— 报表目录检索/描述；</li>
 *   <li>POST /api/ai/reports/{code}/execute —— body {params:{...}}（下钻同路径，携带 drill 参数即明细）；</li>
 *   <li>GET /api/ai/datasets/{id} —— {rows, page:{current,size,total}, columns}（再鉴权/过期 410）。</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiCatalogController {

    private final AiFeatureService featureService;
    private final AiReportService reportService;
    private final AiDatasetService datasetService;
    private final AiToolSupport support;

    /** 执行请求体：params 为准（parameters 兼容别名）。 */
    public record ExecuteRequest(Map<String, Object> params, Map<String, Object> parameters) {
    }

    // ==================== §12.1 功能目录 ====================

    @GetMapping("/features")
    public R<List<Map<String, Object>>> features() {
        return R.ok(featureService.visibleFor(support.currentUser()).stream()
                .map(featureService::view).toList());
    }

    /** §10.2 受控导航校验：featureCode 非法 400 / 用户不可见 403。 */
    @GetMapping("/features/{code}")
    public R<Map<String, Object>> feature(@PathVariable String code) {
        return R.ok(featureService.view(featureService.requireVisible(code, support.currentUser())));
    }

    // ==================== §11 报表目录 ====================

    @GetMapping("/reports")
    public R<List<Map<String, Object>>> reports(@RequestParam(required = false) String keyword) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (AiReportCatalog r : reportService.search(keyword)) {
            out.add(reportService.describe(r));
        }
        return R.ok(out);
    }

    @GetMapping("/reports/{code}")
    public R<Map<String, Object>> report(@PathVariable String code) {
        return R.ok(reportService.describe(reportService.require(code)));
    }

    /**
     * 执行报表（前端 chart 卡下钻回调同此路径）：白名单外参数 400；携带 drill 参数返回明细
     * （>20 行落 ai_dataset，rows 截断 + datasetId + total）。
     */
    @PostMapping("/reports/{code}/execute")
    public R<Map<String, Object>> execute(@PathVariable String code,
                                          @RequestBody(required = false) ExecuteRequest req) {
        Map<String, Object> params = req == null ? Map.of()
                : (req.params() != null ? req.params()
                : (req.parameters() != null ? req.parameters() : Map.of()));
        AiReportService.ExecResult r = reportService.execute(code, params, support.currentUser(), null);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("reportCode", r.reportCode());
        out.put("title", r.title());
        out.put("detail", r.detail());
        if (r.detail()) {
            out.put("columns", r.columns());
            out.put("rows", r.rows());
            out.put("total", r.total());
            if (r.datasetId() != null) {
                out.put("datasetId", r.datasetId());
            }
        } else {
            out.put("chartType", r.chartType());
            out.put("categories", r.categories());
            out.put("data", r.data());
            if (r.drill() != null) {
                out.put("drill", r.drill());
            }
        }
        return R.ok(out);
    }

    // ==================== §11.2 数据集 ====================

    /** 契约对账形状：{rows, page:{current,size,total}, columns}。 */
    @GetMapping("/datasets/{id}")
    public R<Map<String, Object>> dataset(@PathVariable Long id,
                                          @RequestParam(defaultValue = "1") int pageNum,
                                          @RequestParam(defaultValue = "20") int pageSize) {
        PageResult<Map<String, Object>> page = datasetService.page(id, pageNum, pageSize, support.currentUser());
        Map<String, Object> meta = datasetService.meta(id, support.currentUser());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", page.getList());
        out.put("page", Map.of("current", page.getPageNum(), "size", page.getPageSize(),
                "total", page.getTotal()));
        out.put("columns", meta.get("columns"));
        out.put("reportCode", meta.get("reportCode"));
        return R.ok(out);
    }
}
