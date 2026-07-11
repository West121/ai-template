package com.xingchen.oa.workflow.llm;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * OpenAI function-calling 循环公共基建（编排 agent 节点与 AI 智能助手同源复用，契约 ai-assistant §1）：
 * messages 累积 → LLM 返回 tool_calls → 逐个执行工具 → role:tool 回填 → 循环至无 tool_calls 或 maxSteps
 * （超限记 warning 取最后 assistant 内容）。协议 OpenAI-compatible `{baseUrl}/chat/completions`，不引 SDK。
 *
 * <p>纯静态无状态：调用方提供凭据/消息/工具 schema/执行器；线程模型由调用方决定
 * （AI 助手在请求线程同步跑——UserContext 天然在 ThreadLocal；编排在执行线程池跑）。
 */
public final class LlmToolLoop {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();
    public static final int HARD_MAX_STEPS = 15;

    private LlmToolLoop() {
    }

    /** LLM 端点配置。 */
    public record Config(String baseUrl, String apiKey, String model,
                         Double temperature, Integer maxTokens, int maxSteps, long timeoutMs) {
    }

    /** 工具执行器：返回喂回 LLM 的字符串（JSON/文本）。 */
    public interface ToolExecutor {
        String execute(String toolName, Map<String, Object> args) throws Exception;
    }

    /**
     * @param content 最终 assistant 文本
     * @param steps   工具步明细 [{step, tool, args, result(≤500字)}]（审计/留痕）
     * @param warning 超 maxSteps 等告警；无则 null
     */
    public record Result(String content, List<Map<String, Object>> steps, String warning) {
    }

    /** 跑一轮完整循环。messages 为初始消息（system/user/历史），会被原地追加。 */
    @SuppressWarnings("unchecked")
    public static Result run(Config cfg, List<Map<String, Object>> messages,
                             List<Map<String, Object>> toolSchemas, ToolExecutor executor,
                             ObjectMapper mapper) throws Exception {
        int maxSteps = Math.max(1, Math.min(cfg.maxSteps(), HARD_MAX_STEPS));
        long deadline = System.currentTimeMillis() + Math.max(5_000, cfg.timeoutMs());
        String endpoint = cfg.baseUrl().replaceAll("/+$", "") + "/chat/completions";

        List<Map<String, Object>> steps = new ArrayList<>();
        String warning = null;
        String finalContent = null;
        for (int step = 1; step <= maxSteps; step++) {
            long remain = deadline - System.currentTimeMillis();
            if (remain <= 0) {
                throw new IllegalStateException("LLM 循环整体超时");
            }
            Map<String, Object> req = new LinkedHashMap<>();
            req.put("model", cfg.model());
            req.put("messages", messages);
            if (toolSchemas != null && !toolSchemas.isEmpty()) {
                req.put("tools", toolSchemas);
            }
            if (cfg.temperature() != null) {
                req.put("temperature", cfg.temperature());
            }
            if (cfg.maxTokens() != null) {
                req.put("max_tokens", cfg.maxTokens());
            }
            JsonNode message = chat(endpoint, cfg.apiKey(), mapper.writeValueAsString(req), remain, mapper);

            JsonNode toolCalls = message.path("tool_calls");
            if (!toolCalls.isArray() || toolCalls.isEmpty()) {
                finalContent = message.path("content").asString(null);
                break;
            }
            Map<String, Object> assistantMsg = new LinkedHashMap<>();
            assistantMsg.put("role", "assistant");
            assistantMsg.put("content", message.path("content").isNull() ? null
                    : message.path("content").asString(null));
            assistantMsg.put("tool_calls", mapper.treeToValue(toolCalls, List.class));
            messages.add(assistantMsg);

            for (JsonNode call : toolCalls) {
                String callId = call.path("id").asString("call_" + step);
                String toolName = call.path("function").path("name").asString("");
                Map<String, Object> args;
                try {
                    args = mapper.readValue(call.path("function").path("arguments").asString("{}"), Map.class);
                } catch (Exception e) {
                    args = new LinkedHashMap<>();
                }
                String result;
                try {
                    result = executor.execute(toolName, args);
                } catch (Exception e) {
                    result = "{\"error\":\"" + String.valueOf(e.getMessage()).replace("\"", "'") + "\"}";
                }
                steps.add(Map.of("step", steps.size() + 1, "tool", toolName, "args", args,
                        "result", result.length() > 500 ? result.substring(0, 500) : result));
                Map<String, Object> toolMsg = new LinkedHashMap<>();
                toolMsg.put("role", "tool");
                toolMsg.put("tool_call_id", callId);
                toolMsg.put("content", result);
                messages.add(toolMsg);
            }
            if (step == maxSteps) {
                warning = "达到 maxSteps 上限(" + maxSteps + ")，取最后 assistant 内容";
                finalContent = message.path("content").asString(null);
            }
        }
        return new Result(finalContent, steps, warning);
    }

    /** 单个工具的 OpenAI function schema（name/description/参数 properties+required）。 */
    public static Map<String, Object> toolSchema(String name, String description,
                                                 Map<String, Object> properties, List<String> required) {
        return Map.of("type", "function", "function", Map.of(
                "name", name, "description", description,
                "parameters", Map.of("type", "object", "properties", properties, "required", required)));
    }

    private static JsonNode chat(String endpoint, String apiKey, String body, long timeoutMs,
                                 ObjectMapper mapper) throws Exception {
        HttpRequest req = HttpRequest.newBuilder().uri(URI.create(endpoint))
                .timeout(Duration.ofMillis(Math.min(timeoutMs, 120_000)))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> resp = CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() >= 400) {
            throw new IllegalStateException("LLM HTTP " + resp.statusCode() + ": "
                    + resp.body().substring(0, Math.min(200, resp.body().length())));
        }
        JsonNode message = mapper.readTree(resp.body()).path("choices").path(0).path("message");
        if (message.isMissingNode()) {
            throw new IllegalStateException("LLM 响应缺少 choices[0].message");
        }
        return message;
    }
}
