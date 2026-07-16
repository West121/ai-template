package com.hentor.oa.workflow.orch.engine.nodes;

import com.hentor.oa.workflow.orch.engine.OrchCipher;
import com.hentor.oa.workflow.orch.engine.OrchRunContext;
import com.hentor.oa.workflow.orch.engine.OrchSpringHolder;
import com.hentor.oa.workflow.orch.engine.OrchTemplate;
import com.hentor.oa.workflow.orch.entity.OrchCredential;
import com.hentor.oa.workflow.orch.repository.OrchCredentialRepository;
import org.springframework.util.StringUtils;
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
 * LLM(AI) 节点（契约 §4）：OpenAI-compatible HTTP（{baseUrl}/chat/completions，不引 SDK，
 * 兼容 DeepSeek/Qwen/Ollama/OpenAI）。config {credentialId, model?, systemPrompt?, userPrompt,
 * temperature?, maxTokens?, timeoutMs(默认60s), outputMode TEXT|JSON, saveAs}。
 * 凭据只引 credentialId（designer_json 不落明文 key）。JSON 模式解析失败按节点失败走 retry/onError。
 */
public class OrchLlmNode extends OrchBaseNode {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();

    @Override
    protected Object inputSummary(OrchRunContext ctx, JsonNode node, JsonNode config) {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        Map<String, Object> in = new LinkedHashMap<>();
        in.put("credentialId", config.path("credentialId").asLong(0));
        in.put("model", config.path("model").asString(null));
        in.put("outputMode", config.path("outputMode").asString("TEXT"));
        in.put("userPrompt", tpl.renderString(config.path("userPrompt").asString(""), ctx.evalCtx()));
        return in;
    }

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) throws Exception {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        ObjectMapper mapper = OrchSpringHolder.bean(ObjectMapper.class);
        Map<String, Object> evalCtx = ctx.evalCtx();

        long credentialId = config.path("credentialId").asLong(0);
        OrchCredential cred = OrchSpringHolder.bean(OrchCredentialRepository.class)
                .findById(credentialId).orElse(null);
        if (cred == null || !Boolean.TRUE.equals(cred.getEnabled())) {
            throw new IllegalStateException("LLM 凭据不存在或已停用: " + credentialId);
        }
        String apiKey = OrchSpringHolder.bean(OrchCipher.class).decrypt(cred.getApiKeyEnc());
        String baseUrl = cred.getBaseUrl();
        if (!StringUtils.hasText(baseUrl)) {
            throw new IllegalStateException("LLM 凭据缺少 baseUrl");
        }
        String model = StringUtils.hasText(config.path("model").asString(null))
                ? config.path("model").asString(null) : cred.getModel();
        String outputMode = config.path("outputMode").asString("TEXT").toUpperCase();
        long timeoutMs = Math.max(1000, Math.min(config.path("timeoutMs").asLong(60_000), 300_000));

        List<Map<String, String>> messages = new ArrayList<>();
        String system = tpl.renderString(config.path("systemPrompt").asString(null), evalCtx);
        if ("JSON".equals(outputMode)) {
            String jsonHint = "你必须只输出一个合法的 JSON 对象，不得包含任何其他文字、解释或 markdown 代码块标记。";
            system = StringUtils.hasText(system) ? system + "\n" + jsonHint : jsonHint;
        }
        if (StringUtils.hasText(system)) {
            messages.add(Map.of("role", "system", "content", system));
        }
        messages.add(Map.of("role", "user",
                "content", String.valueOf(tpl.renderString(config.path("userPrompt").asString(""), evalCtx))));

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("model", model);
        req.put("messages", messages);
        if (config.hasNonNull("temperature")) {
            req.put("temperature", config.path("temperature").asDouble());
        }
        if (config.hasNonNull("maxTokens")) {
            req.put("max_tokens", config.path("maxTokens").asInt());
        }

        String endpoint = baseUrl.replaceAll("/+$", "") + "/chat/completions";
        HttpRequest httpReq = HttpRequest.newBuilder().uri(URI.create(endpoint))
                .timeout(Duration.ofMillis(timeoutMs))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(req), StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> resp = CLIENT.send(httpReq, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() >= 400) {
            throw new IllegalStateException("LLM HTTP " + resp.statusCode() + ": "
                    + resp.body().substring(0, Math.min(200, resp.body().length())));
        }
        JsonNode root = mapper.readTree(resp.body());
        String content = root.path("choices").path(0).path("message").path("content").asString(null);
        if (content == null) {
            throw new IllegalStateException("LLM 响应缺少 choices[0].message.content");
        }
        if ("JSON".equals(outputMode)) {
            String cleaned = stripFences(content);
            try {
                return mapper.readValue(cleaned, Map.class);
            } catch (Exception e) {
                throw new IllegalStateException("LLM JSON 输出解析失败: " + e.getMessage());
            }
        }
        return content;
    }

    /** 容错剥掉 ```json ... ``` 围栏。 */
    private String stripFences(String s) {
        String t = s.trim();
        if (t.startsWith("```")) {
            int nl = t.indexOf('\n');
            t = nl > 0 ? t.substring(nl + 1) : t;
            int end = t.lastIndexOf("```");
            if (end >= 0) {
                t = t.substring(0, end);
            }
        }
        return t.trim();
    }
}
