package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.service.AiApprovalInsightService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 审批洞察工具（批E，附3 亮点⑨）：{@code task_get_detail} 返回待办 AI 摘要 + 风险提示卡
 * （{@link AiApprovalInsightService}，按 taskId 缓存 30min）。摘要与风险标注「AI 生成仅供参考」。
 *
 * <p><b>卡片契约（给疾风）</b>：list 卡（摘要/风险行）+ 卡级 {@code aiSummary:{summary,risks,disclaimer}}。
 */
@Component
@RequiredArgsConstructor
public class ApprovalInsightTools {

    private final AiToolSupport support;
    private final AiApprovalInsightService insightService;

    @AiToolDefinition(name = "task_get_detail", aliases = {"get_task_summary"},
            risk = AiToolRisk.READ_ONLY, timeoutSeconds = 30,
            description = "查看某个待办审批任务的 AI 摘要与风险提示（表单要点、金额/超期/高频等异常）。"
                    + "参数 taskId（可先用 task_query_my_tasks 获取）。",
            paramsSchema = "{\"taskId\":{\"type\":\"string\",\"description\":\"待办任务 id\"}}",
            required = {"taskId"})
    @SuppressWarnings("unchecked")
    public ToolResult taskDetail(Map<String, Object> args) {
        String taskId = String.valueOf(args.get("taskId"));
        Map<String, Object> aiSummary = insightService.aiSummary(taskId);
        String summary = aiSummary == null ? "" : String.valueOf(aiSummary.getOrDefault("summary", ""));
        List<Map<String, Object>> risks = aiSummary != null && aiSummary.get("risks") instanceof List<?> l
                ? (List<Map<String, Object>>) l : List.of();

        List<Map<String, Object>> rows = new ArrayList<>();
        rows.add(row("AI 摘要", summary));
        for (Map<String, Object> r : risks) {
            rows.add(row("风险(" + r.getOrDefault("level", "") + ")", String.valueOf(r.getOrDefault("text", ""))));
        }
        rows.add(row("说明", AiApprovalInsightService.DISCLAIMER));

        Map<String, Object> card = support.listCard("待办 AI 摘要",
                List.of(support.col("item", "项"), support.col("detail", "内容")), rows, null);
        card.put("aiSummary", aiSummary); // 卡级 aiSummary（前端渲染摘要区）

        Map<String, Object> llm = new LinkedHashMap<>();
        llm.put("taskId", taskId);
        llm.put("summary", summary);
        llm.put("risks", risks);
        llm.put("disclaimer", AiApprovalInsightService.DISCLAIMER);
        return ToolResult.of(support.toJson(llm), card);
    }

    private Map<String, Object> row(String item, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("item", item);
        m.put("detail", StringUtils.hasText(detail) ? detail : "-");
        return m;
    }
}
