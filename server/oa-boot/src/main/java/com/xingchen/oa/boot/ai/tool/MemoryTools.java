package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.service.AiActionService;
import com.xingchen.oa.boot.ai.service.AiMemoryService;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 长期记忆工具（ai-assistant-design-v2.md §13.4，批D）：{@code memory_remember} 风险 CONFIRM_REQUIRED——
 * 走批A 动作草稿二段式确认（工具产确认卡，用户确认后执行器落库）。敏感黑名单（密码/token/证件/薪酬）
 * 在 stage 前拒绝，命中不生成确认卡（{@link AiMemoryService#assertNotSensitive}）。
 */
@Component
@RequiredArgsConstructor
public class MemoryTools {

    private final AiToolSupport support;
    private final AiActionService actionService;
    private final AiMemoryService memoryService;
    private final AiSessionHolder sessionHolder;

    /** 注册确认执行器（confirm 时在确认请求线程执行，UserContext=确认者）。 */
    @PostConstruct
    public void registerExecutors() {
        actionService.registerExecutor("remember_memory", params -> {
            String key = String.valueOf(params.get("key"));
            String value = String.valueOf(params.get("value"));
            Object smid = params.get("sourceMessageId");
            var m = memoryService.remember(key, value,
                    smid instanceof Number n ? n.longValue() : null);
            return Map.of("memoryId", m.getId(), "key", m.getMemoryKey(), "value", m.getMemoryValue());
        });
    }

    @AiToolDefinition(name = "memory_remember", aliases = {"remember_memory"},
            risk = AiToolRisk.CONFIRM_REQUIRED,
            description = "记住用户的长期偏好（如常用部门、汇报对象、显示偏好）。产出确认卡，用户确认后才落库。"
                    + "禁止记忆密码/证件/薪酬等敏感信息，也不要记忆待办余额等业务实时状态。"
                    + "参数 key=偏好名（如 常用部门）、value=偏好值。",
            paramsSchema = "{\"key\":{\"type\":\"string\",\"description\":\"偏好名，如 常用部门/汇报对象\"},"
                    + "\"value\":{\"type\":\"string\",\"description\":\"偏好值\"}}",
            required = {"key", "value"})
    public ToolResult remember(Map<String, Object> args) {
        String key = String.valueOf(args.getOrDefault("key", "")).trim();
        String value = String.valueOf(args.getOrDefault("value", "")).trim();
        // 敏感黑名单：命中即拒（不生成确认卡）
        memoryService.assertNotSensitive(key, value);

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("key", key);
        params.put("value", value);
        AiSessionHolder.Turn turn = sessionHolder.currentTurn();
        if (turn != null && turn.messageId() != null) {
            params.put("sourceMessageId", turn.messageId());
        }
        String actionId = actionService.stage(turn != null ? turn.sessionId() : null,
                turn != null ? turn.messageId() : null, "remember_memory", "MEMORY_REMEMBER", params, null);
        Map<String, Object> card = support.confirmCard(actionId, "记住偏好",
                key + " = " + value, params, false);
        return ToolResult.of(support.toJson(Map.of("staged", true, "actionId", actionId,
                "note", "已生成确认卡，用户确认后才会记住")), card);
    }
}
