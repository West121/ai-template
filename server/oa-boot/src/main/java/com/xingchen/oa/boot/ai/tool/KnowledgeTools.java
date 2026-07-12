package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.office.knowledge.dto.KbDtos.SearchHit;
import com.xingchen.oa.office.knowledge.service.KbSearchService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 知识库工具（ai-knowledge-base.md §3 批2）：AI 助手「问知识库」入口。
 *
 * <p>两个只读工具，全部委托 {@link KbSearchService}——检索<b>严格按当前用户可见空间过滤</b>
 * （KbSearchService 内 KbAccess，红线：不越权泄露；工具层 authorities=kb:doc:view 为第一道门，
 * 服务层可见空间过滤为第二道）。命中产出 {@code KB_DOC} 引用（docId/title/space，前端可跳）。</p>
 *
 * <ul>
 *   <li>{@code knowledge_search}：检索知识库文档，返回命中列表卡片；</li>
 *   <li>{@code knowledge_ask}：取 Top 命中作为「参考资料」数据帧喂回模型，由模型据此作答带引用。</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class KnowledgeTools {

    private final AiToolSupport support;
    private final KbSearchService kbSearchService;

    @AiToolDefinition(name = "knowledge_search", aliases = {"kb_search"},
            description = "在企业知识库中检索文档（语义+全文混合，仅限我有权限的知识空间）。"
                    + "参数 q 必填（问题/关键词）；spaceId 可选（限定单个空间）。",
            paramsSchema = "{\"q\":{\"type\":\"string\",\"description\":\"检索关键词或问题\"},"
                    + "\"spaceId\":{\"type\":\"integer\",\"description\":\"可选，限定知识空间 id\"}}",
            required = {"q"}, authorities = {"kb:doc:view"}, risk = AiToolRisk.READ_ONLY)
    public ToolResult knowledgeSearch(Map<String, Object> args) {
        String q = str(args, "q");
        Long spaceId = lng(args, "spaceId");
        List<SearchHit> hits = kbSearchService.search(q, spaceId, 1, 8).getList();
        List<Map<String, Object>> rows = new ArrayList<>();
        List<Map<String, Object>> citations = new ArrayList<>();
        for (SearchHit h : hits) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("title", h.title());
            row.put("space", h.spaceName());
            row.put("spaceId", h.spaceId()); // 行级跳转用（前端 /knowledge/{spaceId}?doc={docId}）
            row.put("docId", h.docId());
            row.put("snippet", strip(h.snippet()));
            rows.add(row);
            citations.add(citation(h));
        }
        Map<String, Object> card = support.listCard("知识库检索：" + q,
                List.of(support.col("title", "文档"), support.col("space", "空间"), support.col("snippet", "片段")),
                rows, "/knowledge");
        return ToolResult.of(support.toJson(Map.of("count", rows.size(), "items", rows)), card)
                .withCitations(citations);
    }

    @AiToolDefinition(name = "knowledge_ask", aliases = {"kb_ask"},
            description = "就某个问题检索知识库并返回相关文档片段作为参考资料（仅限我有权限的空间），据此回答并给出引用。"
                    + "参数 question 必填。",
            paramsSchema = "{\"question\":{\"type\":\"string\",\"description\":\"要在知识库中查询的问题\"}}",
            required = {"question"}, authorities = {"kb:doc:view"}, risk = AiToolRisk.READ_ONLY)
    public ToolResult knowledgeAsk(Map<String, Object> args) {
        String question = str(args, "question");
        List<SearchHit> hits = kbSearchService.ragRetrieve(question, 3);
        List<Map<String, Object>> refs = new ArrayList<>();
        List<Map<String, Object>> citations = new ArrayList<>();
        for (SearchHit h : hits) {
            Map<String, Object> ref = new LinkedHashMap<>();
            ref.put("title", h.title());
            ref.put("space", h.spaceName());
            ref.put("content", strip(h.snippet()));
            refs.add(ref);
            citations.add(citation(h));
        }
        String llm = refs.isEmpty()
                ? support.toJson(Map.of("found", false, "hint", "知识库中未检索到相关文档"))
                : support.toJson(Map.of("found", true, "references", refs,
                        "note", "以上为知识库参考资料，请据此作答并标注引用来源"));
        return ToolResult.of(llm).withCitations(citations);
    }

    private Map<String, Object> citation(SearchHit h) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("sourceType", "KB_DOC");
        c.put("sourceId", String.valueOf(h.docId()));
        c.put("title", h.title() == null ? "" : h.title());
        c.put("spaceId", h.spaceId()); // 前端 /knowledge/{spaceId}?doc={docId} 精确定位
        c.put("space", h.spaceName() == null ? "" : h.spaceName());
        return c;
    }

    private static String strip(String s) {
        return s == null ? "" : s.replace("<mark>", "").replace("</mark>", "");
    }

    private String str(Map<String, Object> args, String key) {
        Object v = args.get(key);
        return v == null || !StringUtils.hasText(String.valueOf(v)) ? null : String.valueOf(v).trim();
    }

    private Long lng(Map<String, Object> args, String key) {
        Object v = args.get(key);
        if (v == null) {
            return null;
        }
        try {
            return v instanceof Number num ? num.longValue() : Long.parseLong(String.valueOf(v).trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
