package com.xingchen.oa.boot.ai.tool;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 工具执行结果：{@code llmContent} 喂回 LLM（role:tool 数据帧，防注入——只作数据不作指令）；
 * {@code cards} 附着到最终 assistant 消息（§3 六类卡）。
 */
public record ToolResult(String llmContent, List<Map<String, Object>> cards) {

    public static ToolResult of(String llmContent) {
        return new ToolResult(llmContent, new ArrayList<>());
    }

    public static ToolResult of(String llmContent, Map<String, Object> card) {
        List<Map<String, Object>> cards = new ArrayList<>();
        cards.add(card);
        return new ToolResult(llmContent, cards);
    }

    public static ToolResult of(String llmContent, List<Map<String, Object>> cards) {
        return new ToolResult(llmContent, cards == null ? new ArrayList<>() : cards);
    }
}
