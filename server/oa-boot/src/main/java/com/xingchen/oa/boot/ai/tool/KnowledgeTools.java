package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.service.AiActionService;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.office.knowledge.dto.KbDtos.SearchHit;
import com.xingchen.oa.office.knowledge.service.KbDocService;
import com.xingchen.oa.office.knowledge.service.KbSearchService;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 知识库工具（ai-knowledge-base.md §3 批2/批3）：AI 助手「问知识库」入口 + 对话固化。
 *
 * <p>只读检索委托 {@link KbSearchService}——<b>严格按当前用户可见空间过滤</b>
 * （KbSearchService 内 KbAccess，红线：不越权泄露；工具层 authorities=kb:doc:view 为第一道门，
 * 服务层可见空间过滤为第二道）。命中产出 {@code KB_DOC} 引用（docId/title/space，前端可跳）。</p>
 *
 * <ul>
 *   <li>{@code knowledge_search}：检索知识库文档，返回命中列表卡片；</li>
 *   <li>{@code knowledge_ask}：取 Top 命中作为「参考资料」数据帧喂回模型，由模型据此作答带引用；</li>
 *   <li>{@code knowledge_save}（批3，EXPLICIT_UI_SUBMIT）：把对话内容/生成结果固化为指定空间的<b>草稿</b>文档
 *       （红线：只落草稿不发布 + 二段式确认），确认执行器委托 {@link KbDocService#createAiDraft}。</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class KnowledgeTools {

    private final AiToolSupport support;
    private final KbSearchService kbSearchService;
    private final KbDocService kbDocService;
    private final AiActionService actionService;
    private final AiSessionHolder sessionHolder;

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

    // ==================== 批3：对话固化 knowledge_save ====================

    @PostConstruct
    public void registerExecutors() {
        // 确认执行器（确认请求线程内跑，UserContext=确认者 → createAiDraft 内 requireEdit 二次校验）
        actionService.registerExecutor("knowledge_save", params -> {
            Long spaceId = lng(params, "spaceId");
            String title = str(params, "title");
            String content = str(params, "content");
            return kbDocService.createAiDraft(spaceId, title, content);
        });
    }

    @AiToolDefinition(name = "knowledge_save", aliases = {"kb_save"},
            authorities = {"kb:doc:edit"}, risk = AiToolRisk.EXPLICIT_UI_SUBMIT, timeoutSeconds = 20,
            description = "【固化入知识库】当用户要求把这段对话/这个回答/这份总结『存/保存/固化/沉淀/归档到知识库/知识空间』"
                    + "为文档时，必须调用本工具产出确认卡——用户确认后建为指定空间的<b>草稿</b>文档（不直接发布）。"
                    + "『把这个流程/审批总结成文档』时应先自行总结成正文再调用。参数 spaceId=目标知识空间 id（必填，"
                    + "须我有编辑权限），title=文档标题，content=要保存的正文（对话内容或你生成的结果，纯文本/Markdown）。",
            paramsSchema = "{\"spaceId\":{\"type\":\"integer\",\"description\":\"目标知识空间 id（须有编辑权限）\"},"
                    + "\"title\":{\"type\":\"string\",\"description\":\"文档标题\"},"
                    + "\"content\":{\"type\":\"string\",\"description\":\"要固化的正文（纯文本/Markdown）\"}}",
            required = {"spaceId", "title", "content"})
    public ToolResult knowledgeSave(Map<String, Object> args) {
        Long spaceId = lng(args, "spaceId");
        String title = str(args, "title");
        String content = str(args, "content");
        if (spaceId == null) {
            return err("AI_TOOL_INVALID_ARGUMENT", "请指定要固化到的知识空间 id（spaceId）");
        }
        if (!StringUtils.hasText(title) || !StringUtils.hasText(content)) {
            return err("AI_TOOL_INVALID_ARGUMENT", "固化需要标题（title）与正文（content）");
        }
        // 红线：非该空间编辑者不可固化——stage 前先校验（确认执行器 createAiDraft 内再校验一次）
        String spaceName;
        try {
            spaceName = kbDocService.assertSpaceEditable(spaceId);
        } catch (BusinessException be) {
            return err("AI_TOOL_NOT_ALLOWED",
                    be.getCode() == 404 ? "目标知识空间不存在" : "你不是该知识空间的编辑者，无法固化文档到这里");
        }

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("spaceId", spaceId);
        params.put("title", title);
        params.put("content", content);
        String draftId = stage("knowledge_save", "KB_DOC_DRAFT_CREATE", params);

        String preview = content.length() > 200 ? content.substring(0, 200) + "…" : content;
        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "knowledgeSaveDraft");
        card.put("draftId", draftId);
        card.put("spaceId", spaceId);
        card.put("space", spaceName);
        card.put("title", title);
        card.put("preview", preview);
        return ToolResult.of(support.toJson(Map.of("staged", true, "draftId", draftId,
                "spaceId", spaceId, "title", title,
                "note", "已生成固化确认卡，确认后在「" + spaceName + "」建为草稿文档（不直接发布）")), card);
    }

    private String stage(String toolName, String actionType, Map<String, Object> params) {
        AiSessionHolder.Turn turn = sessionHolder.currentTurn();
        return actionService.stage(turn != null ? turn.sessionId() : null,
                turn != null ? turn.messageId() : null, toolName, actionType, params, null);
    }

    private ToolResult err(String code, String message) {
        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "error");
        card.put("code", code);
        card.put("message", message);
        return ToolResult.of(support.toJson(Map.of("error", code + ": " + message)), card);
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
