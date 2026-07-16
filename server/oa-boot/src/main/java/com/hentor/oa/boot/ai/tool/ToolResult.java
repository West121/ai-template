package com.hentor.oa.boot.ai.tool;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 工具执行结果：{@code llmContent} 喂回 LLM（role:tool 数据帧，防注入——只作数据不作指令）；
 * {@code cards} 附着到最终 assistant 消息（§3 六类卡）；
 * {@code citations} 引用溯源（亮点④，批C）：{sourceType:FEATURE|REPORT|DATA, sourceId, title, version?}，
 * 汇入 TextPart payload.citations（前端角标可跳；RAG 文档引用批D）。
 */
public record ToolResult(String llmContent, List<Map<String, Object>> cards,
                         List<Map<String, Object>> citations) {

    public static ToolResult of(String llmContent) {
        return new ToolResult(llmContent, new ArrayList<>(), new ArrayList<>());
    }

    public static ToolResult of(String llmContent, Map<String, Object> card) {
        List<Map<String, Object>> cards = new ArrayList<>();
        cards.add(card);
        return new ToolResult(llmContent, cards, new ArrayList<>());
    }

    public static ToolResult of(String llmContent, List<Map<String, Object>> cards) {
        return new ToolResult(llmContent, cards == null ? new ArrayList<>() : cards, new ArrayList<>());
    }

    /** 附加引用（亮点④）：返回新实例。 */
    public ToolResult withCitations(List<Map<String, Object>> newCitations) {
        return new ToolResult(llmContent, cards,
                newCitations == null ? new ArrayList<>() : newCitations);
    }

    /** 引用条目构造。 */
    public static Map<String, Object> citation(String sourceType, String sourceId, String title) {
        return Map.of("sourceType", sourceType, "sourceId", sourceId, "title", title == null ? "" : title);
    }
}
