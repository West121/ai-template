package com.hentor.oa.workflow.engine.ai;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 默认 AI 审批实现（P3）：
 * - {@code oa.ai.enabled=true} 且 apiKey 非空 → 调 OpenAI 兼容 chat completions，
 *   要求模型只返回 JSON {"decision":"APPROVE|REJECT","comment":"..."}；解析失败或异常降级模拟。
 * - 否则 → 规则模拟：默认通过，意见以「AI模拟」明示（不冒充真实模型）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DefaultAiApprovalProvider implements AiApprovalProvider {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();

    private final OaAiProperties props;
    private final ObjectMapper objectMapper;

    @Override
    public AiDecision decide(String model, String systemPrompt, Map<String, Object> context) {
        if (props.isEnabled() && StringUtils.hasText(props.getApiKey())) {
            try {
                return callApi(model, systemPrompt, context);
            } catch (Exception e) {
                log.warn("AI 审批真实调用失败，降级模拟: {}", e.getMessage());
            }
        }
        return simulate(context);
    }

    /** 规则模拟：默认通过；可按上下文做简单规则（如金额过大提示人工复核仍放行）。 */
    private AiDecision simulate(Map<String, Object> context) {
        String summary = context == null || context.isEmpty() ? "无上下文" : context.toString();
        return new AiDecision("APPROVE",
                "AI模拟：未配置 AI 密钥，按规则默认通过（上下文：" + truncate(summary) + "）", true);
    }

    private AiDecision callApi(String model, String systemPrompt, Map<String, Object> context) throws Exception {
        String useModel = StringUtils.hasText(model) ? model : props.getModel();
        // 节点可自定义审批准则；但无论是否自定义，都强制追加 JSON 输出格式约束，
        // 否则模型（尤其自定义 prompt 时）会返回自然语言导致 decision/comment 解析失败、误判为默认通过。
        String base = StringUtils.hasText(systemPrompt) ? systemPrompt
                : "你是审批助手，基于给定表单上下文判断是否通过。";
        String sys = base
                + "\n\n【输出要求】你必须严格只返回一个 JSON 对象，不要包含 markdown 代码块或任何解释文字，"
                + "格式为：{\"decision\":\"APPROVE 或 REJECT\",\"comment\":\"简要中文理由\"}。";
        String userMsg = "表单上下文：" + objectMapper.writeValueAsString(context);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", useModel);
        body.put("temperature", 0);
        // DeepSeek / OpenAI 兼容的 JSON 输出模式，进一步保证可解析
        body.put("response_format", Map.of("type", "json_object"));
        body.put("messages", List.of(
                Map.of("role", "system", "content", sys),
                Map.of("role", "user", "content", userMsg)));

        HttpRequest req = HttpRequest.newBuilder(URI.create(props.getBaseUrl().replaceAll("/+$", "") + "/chat/completions"))
                .timeout(Duration.ofSeconds(props.getTimeoutSeconds()))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + props.getApiKey())
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build();
        HttpResponse<String> resp = CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() / 100 != 2) {
            throw new IllegalStateException("AI 网关返回 " + resp.statusCode());
        }
        JsonNode root = objectMapper.readTree(resp.body());
        String content = root.path("choices").path(0).path("message").path("content").asString("");
        JsonNode decision = objectMapper.readTree(extractJson(content));
        String d = decision.path("decision").asString("APPROVE").toUpperCase();
        String comment = "AI：" + decision.path("comment").asString("（无理由）");
        return new AiDecision("REJECT".equals(d) ? "REJECT" : "APPROVE", comment, false);
    }

    /** 从模型输出中截取首个 JSON 对象（容忍前后多余文本）。 */
    private String extractJson(String content) {
        int s = content.indexOf('{');
        int e = content.lastIndexOf('}');
        return (s >= 0 && e > s) ? content.substring(s, e + 1) : "{\"decision\":\"APPROVE\"}";
    }

    private String truncate(String s) {
        return s.length() > 120 ? s.substring(0, 120) + "..." : s;
    }
}
