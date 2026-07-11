package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.common.security.UserContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.DefaultToolDefinition;
import org.springframework.ai.tool.definition.ToolDefinition;
import org.springframework.ai.tool.resolution.ToolCallbackResolver;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 动态工具过滤（ai-assistant-design-v2.md §6.3，批B）：每次模型调用前按
 * 用户功能权限 / 风险等级（PROHIBITED 不暴露）/ 系统开关（禁用清单）/ 单次上限 过滤，
 * 只把过滤后的工具（Spring AI {@link ToolCallback}）暴露给模型——无权工具模型看不见。
 * 执行入口 {@link AiToolGateway} 复验（权限过滤后仍须二验，§6.3）。
 *
 * <p>同时提供 Spring AI {@link ToolCallbackResolver}（挂到 ToolCallingManager）：模型按
 * <b>旧名/别名</b>或未暴露名调用时兜底解析——别名映射到规范工具经 Gateway 执行（旧名兼容），
 * 未知名返回礼貌拒绝回调（AI_TOOL_NOT_ALLOWED error 帧，不中断对话）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AuthorizedToolResolver {

    /** ToolContext 键：轮次事件监听（tool.started/completed SSE）。 */
    public static final String CTX_LISTENER = "ai.turnListener";
    /** ToolContext 键：卡片收集器（List&lt;Map&gt;，附着到助手消息）。 */
    public static final String CTX_CARDS = "ai.cards";
    /** ToolContext 键：工具留痕收集器（List&lt;Map&gt;，落 message.tool_calls）。 */
    public static final String CTX_TRACE = "ai.trace";
    /** ToolContext 键：引用收集器（亮点④，汇入 TextPart payload.citations）。 */
    public static final String CTX_CITATIONS = "ai.citations";

    private final ToolRegistry registry;
    private final AiToolGateway gateway;
    private final tools.jackson.databind.ObjectMapper objectMapper;

    /** 单次请求最多暴露工具数（§6.3）。 */
    @Value("${ai-assistant.tools.max-exposed:32}")
    private int maxExposed;

    /** 禁用工具清单（规范名，逗号分隔；系统开关/灰度扩展点）。 */
    @Value("${ai-assistant.tools.disabled:}")
    private String disabledTools;

    /** 事件监听最小面（避免 tool 包反向依赖 service 包的 TurnListener）。 */
    public interface ToolEventListener {
        void toolStarted(String toolCallId, String name);

        void toolCompleted(String toolCallId, String name, long durationMs, boolean failed);
    }

    /** 按当前用户过滤可暴露工具（模型可见面）。 */
    public List<ToolCallback> resolveFor(UserContext user) {
        Set<String> disabled = Arrays.stream(disabledTools.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet());
        List<ToolCallback> out = new ArrayList<>();
        for (ToolRegistry.RegisteredTool tool : registry.all()) {
            AiToolDefinition def = tool.def();
            if (def.risk() == AiToolRisk.PROHIBITED || disabled.contains(def.name())) {
                continue;
            }
            if (!hasAllAuthorities(user, def)) {
                continue; // 无权工具不暴露给模型（§6.3；Gateway 执行入口仍会复验）
            }
            out.add(new GatewayToolCallback(tool.def().name(), def.description(), tool.inputSchema()));
            if (out.size() >= maxExposed) {
                break;
            }
        }
        return out;
    }

    /** ToolCallingManager 兜底解析器：别名 → 规范工具；未知名 → 礼貌拒绝回调。 */
    public ToolCallbackResolver aliasResolver() {
        return name -> {
            String canonical = registry.canonicalName(name);
            ToolRegistry.RegisteredTool tool = registry.get(canonical);
            if (tool != null) {
                // 以模型请求的原名建定义（框架按名回填 tool 消息），执行走 Gateway（内部再做别名解析+复验）
                return new GatewayToolCallback(name, tool.def().description(), tool.inputSchema());
            }
            log.info("AI 工具兜底解析：未知工具名 {} → 礼貌拒绝", name);
            return new GatewayToolCallback(name, "未知工具（将返回拒绝说明）",
                    "{\"type\":\"object\",\"properties\":{},\"required\":[]}");
        };
    }

    private boolean hasAllAuthorities(UserContext user, AiToolDefinition def) {
        if (def.authorities().length == 0) {
            return true;
        }
        List<String> perms = user.getPermissions();
        if (perms == null) {
            return true; // 离线 allow-all（与 hasPerm 口径一致）
        }
        for (String a : def.authorities()) {
            if (!perms.contains(a)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Spring AI ToolCallback → Gateway 桥：解析参数 JSON、发 tool.started/completed 事件、
     * 收集卡片与留痕，返回喂回模型的数据帧。
     */
    private class GatewayToolCallback implements ToolCallback {

        private final ToolDefinition definition;
        private final String name;

        GatewayToolCallback(String name, String description, String inputSchema) {
            this.name = name;
            this.definition = DefaultToolDefinition.builder()
                    .name(name).description(description).inputSchema(inputSchema).build();
        }

        @Override
        public ToolDefinition getToolDefinition() {
            return definition;
        }

        @Override
        public String call(String toolInput) {
            return call(toolInput, new ToolContext(Map.of()));
        }

        @Override
        @SuppressWarnings("unchecked")
        public String call(String toolInput, ToolContext toolContext) {
            Map<String, Object> ctx = toolContext == null ? Map.of() : toolContext.getContext();
            ToolEventListener listener = ctx.get(CTX_LISTENER) instanceof ToolEventListener l ? l : null;
            List<Map<String, Object>> cards = ctx.get(CTX_CARDS) instanceof List<?> c
                    ? (List<Map<String, Object>>) c : null;
            List<Map<String, Object>> trace = ctx.get(CTX_TRACE) instanceof List<?> t
                    ? (List<Map<String, Object>>) t : null;
            List<Map<String, Object>> citations = ctx.get(CTX_CITATIONS) instanceof List<?> ci
                    ? (List<Map<String, Object>>) ci : null;

            Map<String, Object> args = parseArgs(toolInput);
            String toolCallId = "tc_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
            if (listener != null) {
                listener.toolStarted(toolCallId, name);
            }
            long t0 = System.currentTimeMillis();
            ToolResult result = gateway.execute(toolCallId, name, args);
            boolean failed = result.llmContent() != null && result.llmContent().startsWith("{\"error\"");
            if (listener != null) {
                listener.toolCompleted(toolCallId, name, System.currentTimeMillis() - t0, failed);
            }
            if (cards != null && result.cards() != null) {
                cards.addAll(result.cards());
            }
            if (citations != null && result.citations() != null) {
                citations.addAll(result.citations());
            }
            if (trace != null) {
                trace.add(Map.of("step", trace.size() + 1, "tool", name, "args", args,
                        "result", truncate(result.llmContent(), 500)));
            }
            return result.llmContent() == null ? "{}" : result.llmContent();
        }

        private Map<String, Object> parseArgs(String toolInput) {
            try {
                if (toolInput == null || toolInput.isBlank()) {
                    return new LinkedHashMap<>();
                }
                return objectMapper.readValue(toolInput, Map.class);
            } catch (Exception e) {
                return new LinkedHashMap<>();
            }
        }

        private String truncate(String s, int max) {
            return s == null ? "" : (s.length() > max ? s.substring(0, max) : s);
        }
    }
}
