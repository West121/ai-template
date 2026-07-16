package com.hentor.oa.boot.ai.tool;

import com.hentor.oa.boot.ai.service.AiActionService;
import com.hentor.oa.boot.ai.support.AiSessionHolder;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.office.knowledge.dto.KbDtos.SearchHit;
import com.hentor.oa.office.knowledge.dto.KbDtos.SpaceResponse;
import com.hentor.oa.office.knowledge.entity.KbSpaceMember;
import com.hentor.oa.office.knowledge.service.KbDocService;
import com.hentor.oa.office.knowledge.service.KbSearchService;
import com.hentor.oa.office.knowledge.service.KbSpaceService;
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
    private final KbSpaceService kbSpaceService;
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

    @AiToolDefinition(name = "knowledge_spaces", aliases = {"kb_spaces"},
            description = "列出我『可编辑』的知识空间（id + 名称）。固化文档（knowledge_save）前若不确定目标空间，"
                    + "先调用本工具拿到真实空间 id/名称，再固化；不要臆测空间 id。",
            paramsSchema = "{}", authorities = {"kb:doc:view"}, risk = AiToolRisk.READ_ONLY)
    public ToolResult knowledgeSpaces(Map<String, Object> args) {
        List<SpaceResponse> editable = kbSpaceService.editableSpaces();
        List<Map<String, Object>> rows = editableRows(editable);
        Map<String, Object> card = support.listCard("我可编辑的知识空间",
                List.of(support.col("name", "知识空间"), support.col("id", "ID")), rows, "/knowledge");
        Map<String, Object> llm = new LinkedHashMap<>();
        llm.put("count", rows.size());
        llm.put("editableSpaces", rows);
        llm.put("note", rows.isEmpty()
                ? "你没有可编辑的知识空间，无法固化文档。"
                : "以上为可编辑空间；固化时给 knowledge_save 传 space=空间名 或 spaceId=对应 id（不要臆测 id）。");
        return ToolResult.of(support.toJson(llm), card);
    }

    @AiToolDefinition(name = "knowledge_save", aliases = {"kb_save"},
            authorities = {"kb:doc:edit"}, risk = AiToolRisk.EXPLICIT_UI_SUBMIT, timeoutSeconds = 20,
            description = "【固化入知识库】当用户要求把这段对话/这个回答/这份总结『存/保存/固化/沉淀/归档到知识库/知识空间』"
                    + "为文档时，必须调用本工具产出确认卡——用户确认后建为目标空间的<b>草稿</b>文档（不直接发布）。"
                    + "『把这个流程/审批总结成文档』时应先自行总结成正文再调用。"
                    + "目标空间解析（不要臆测 id）：优先传 space=空间名（我会在你可编辑的空间里按名匹配）；或传 spaceId=真实且我可编辑的空间 id；"
                    + "不确定就先调用 knowledge_spaces 拿真实 id，或什么都不传——我只有一个可编辑空间时会直接用它，多于一个会让用户选。"
                    + "参数：space?（空间名，推荐）、spaceId?（空间 id）、title（标题）、content（正文，纯文本/Markdown）。",
            paramsSchema = "{\"space\":{\"type\":\"string\",\"description\":\"目标知识空间名（推荐；在我可编辑的空间里按名匹配）\"},"
                    + "\"spaceId\":{\"type\":\"integer\",\"description\":\"目标知识空间 id（可选；不确定就别猜，改传 space 名或先调 knowledge_spaces）\"},"
                    + "\"title\":{\"type\":\"string\",\"description\":\"文档标题\"},"
                    + "\"content\":{\"type\":\"string\",\"description\":\"要固化的正文（纯文本/Markdown）\"}}",
            required = {"title", "content"})
    public ToolResult knowledgeSave(Map<String, Object> args) {
        Long spaceId = lng(args, "spaceId");
        String spaceName = str(args, "space");
        String title = str(args, "title");
        String content = str(args, "content");
        if (!StringUtils.hasText(title) || !StringUtils.hasText(content)) {
            return err("AI_TOOL_INVALID_ARGUMENT", "固化需要标题（title）与正文（content）");
        }
        // 取当前用户「可编辑」空间集，服务端智能解析目标空间——不再逼模型猜 id
        List<SpaceResponse> editable = kbSpaceService.editableSpaces();
        if (editable.isEmpty()) {
            return err("AI_TOOL_NOT_ALLOWED",
                    "你没有任何可编辑的知识空间，无法固化文档。请先创建知识空间，或联系管理员把你加为某空间的编辑者。");
        }
        SpaceResponse target = resolveSaveSpace(spaceId, spaceName, editable);
        if (target == null) {
            // 多个可编辑且未指明 / 名字歧义或无匹配 → 选择卡（不硬报「目标知识空间不存在」）
            return spacePickResult(editable, spaceName);
        }
        Long resolvedId = target.id();
        // 红线：解析后仍走 assertSpaceEditable 二次校验（与确认执行器 createAiDraft 一致，防越权固化）
        String resolvedName;
        try {
            resolvedName = kbDocService.assertSpaceEditable(resolvedId);
        } catch (BusinessException be) {
            return err("AI_TOOL_NOT_ALLOWED",
                    be.getCode() == 404 ? "目标知识空间不存在" : "你不是该知识空间的编辑者，无法固化文档到这里");
        }

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("spaceId", resolvedId);
        params.put("title", title);
        params.put("content", content);
        String actionId = stage("knowledge_save", "KB_DOC_DRAFT_CREATE", params);

        String preview = content.length() > 200 ? content.substring(0, 200) + "…" : content;
        // 契约（疾风前端 KnowledgeSavePart）：partType=knowledgeSave，payload={actionId,defaultSpaceId,title,contentPreview}
        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "knowledgeSave");
        card.put("actionId", actionId);
        card.put("defaultSpaceId", resolvedId);
        card.put("title", title);
        card.put("contentPreview", preview);
        return ToolResult.of(support.toJson(Map.of("staged", true, "actionId", actionId,
                "spaceId", resolvedId, "space", resolvedName, "title", title,
                "note", "已生成固化确认卡，确认后在「" + resolvedName + "」建为草稿文档（不直接发布）")), card);
    }

    /**
     * 目标空间解析（指定优先 → 按名匹配 → 唯一可编辑直用 → 否则 null 交选择卡）。
     * 关键：给了 spaceId 但不可编辑/不存在（模型臆测的 id）时不硬报错，继续按名/唯一兜底。
     */
    private SpaceResponse resolveSaveSpace(Long spaceId, String spaceName, List<SpaceResponse> editable) {
        // 1) 指定 spaceId 且我可编辑 → 用它
        if (spaceId != null) {
            for (SpaceResponse s : editable) {
                if (s.id().equals(spaceId)) {
                    return s;
                }
            }
            // 给了 id 但不在可编辑集（臆测/无权）→ 不硬用，继续下面按名/唯一兜底
        }
        // 2) 给了空间名 → 可编辑集内按名匹配（精确忽略大小写优先，其次唯一双向包含）
        if (StringUtils.hasText(spaceName)) {
            String key = spaceName.trim();
            List<SpaceResponse> exact = editable.stream()
                    .filter(s -> key.equalsIgnoreCase(s.name())).toList();
            if (exact.size() == 1) {
                return exact.get(0);
            }
            if (exact.isEmpty()) {
                List<SpaceResponse> contains = editable.stream()
                        .filter(s -> s.name() != null && (s.name().contains(key) || key.contains(s.name())))
                        .toList();
                if (contains.size() == 1) {
                    return contains.get(0);
                }
            }
            // 精确多命中 / 包含歧义 → 不猜，落到单空间兜底或选择卡
        }
        // 3) 恰好一个可编辑空间 → 直接用它（最常见，直接成功）
        if (editable.size() == 1) {
            return editable.get(0);
        }
        // 4) 无法确定（多个可编辑且未指明 / 名字歧义无匹配）→ 选择卡
        return null;
    }

    /** 选择空间卡（list 卡，前端确定可渲染）+ 引导模型让用户指明后重试。 */
    private ToolResult spacePickResult(List<SpaceResponse> editable, String triedName) {
        List<Map<String, Object>> rows = editableRows(editable);
        String title = StringUtils.hasText(triedName)
                ? "未能唯一匹配「" + triedName + "」，请选择要固化到的知识空间"
                : "有多个可编辑知识空间，请选择要固化到哪一个";
        Map<String, Object> card = support.listCard(title,
                List.of(support.col("name", "知识空间"), support.col("id", "ID")), rows, "/knowledge");
        String hint = "存在多个可编辑知识空间（或未能确定目标空间）。请让用户从上表中指明空间名或 id，"
                + "然后再次调用 knowledge_save 并传 space=空间名（或 spaceId=数字）。不要臆测空间 id，也不要报『空间不存在』。";
        return ToolResult.of(support.toJson(Map.of("needSpaceSelection", true,
                "editableSpaces", rows, "hint", hint)), card);
    }

    private List<Map<String, Object>> editableRows(List<SpaceResponse> editable) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (SpaceResponse s : editable) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", s.id());
            r.put("name", s.name());
            r.put("role", s.myRole());
            rows.add(r);
        }
        return rows;
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
