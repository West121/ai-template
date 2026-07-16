package com.hentor.oa.boot.ai.service;

import com.hentor.oa.workflow.orch.engine.OrchCipher;
import com.hentor.oa.workflow.orch.entity.OrchCredential;
import com.hentor.oa.workflow.orch.repository.OrchCredentialRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 嵌入服务（ai-assistant-design-v2.md §12，批D）：优先复用 LLM 凭据的 OpenAI 兼容 {@code /embeddings}。
 *
 * <p><b>降级裁定</b>：DeepSeek 无 embeddings 端点——默认 {@code ai-assistant.rag.embedding-enabled=false}，
 * 此时 {@link #embed} 返回 null，{@code AiRagService} 走 PostgreSQL 全文/ILIKE 检索（默认可用路径）。
 * 仅当显式开启且配置了支持 /embeddings 的凭据时才产出向量并按 {@code <=>} 余弦距离检索。
 * 任意调用失败（网络/4xx/解析）一律返回 null → 静默降级，不阻断对话。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiEmbeddingService {

    private final OrchCredentialRepository credentialRepository;
    private final OrchCipher cipher;
    private final ObjectMapper objectMapper;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();

    @Value("${ai-assistant.rag.embedding-enabled:false}")
    private boolean enabled;

    /** 指定嵌入凭据；0=复用最新启用 LLM 凭据。 */
    @Value("${ai-assistant.rag.embedding-credential-id:0}")
    private long embeddingCredentialId;

    @Value("${ai-assistant.rag.embedding-model:text-embedding-3-small}")
    private String embeddingModel;

    public boolean available() {
        return enabled && resolveCredential() != null;
    }

    /**
     * 文本 → 向量（float[]）；未启用/无凭据/任何失败 → null（RAG 降级全文）。
     */
    public float[] embed(String text) {
        if (!enabled || !StringUtils.hasText(text)) {
            return null;
        }
        OrchCredential cred = resolveCredential();
        if (cred == null) {
            return null;
        }
        try {
            String apiKey = cipher.decrypt(cred.getApiKeyEnc());
            String base = cred.getBaseUrl().replaceAll("/+$", "");
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", embeddingModel);
            body.put("input", text);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(base + "/embeddings"))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() / 100 != 2) {
                log.debug("嵌入端点返回 {}（降级全文检索）", resp.statusCode());
                return null;
            }
            JsonNode arr = objectMapper.readTree(resp.body()).path("data").path(0).path("embedding");
            if (!arr.isArray() || arr.isEmpty()) {
                return null;
            }
            float[] vec = new float[arr.size()];
            for (int i = 0; i < arr.size(); i++) {
                vec[i] = (float) arr.get(i).asDouble();
            }
            return vec;
        } catch (Exception e) {
            log.debug("嵌入计算失败（降级全文检索）: {}", e.getMessage());
            return null;
        }
    }

    /** pgvector 字面量：'[0.1,0.2,...]'。 */
    public static String toVectorLiteral(float[] vec) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < vec.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(vec[i]);
        }
        return sb.append(']').toString();
    }

    private OrchCredential resolveCredential() {
        if (embeddingCredentialId > 0) {
            return credentialRepository.findById(embeddingCredentialId)
                    .filter(c -> Boolean.TRUE.equals(c.getEnabled()) && StringUtils.hasText(c.getBaseUrl()))
                    .orElse(null);
        }
        return credentialRepository.findAll().stream()
                .filter(c -> OrchCredential.TYPE_LLM.equals(c.getType()) && Boolean.TRUE.equals(c.getEnabled())
                        && StringUtils.hasText(c.getBaseUrl()))
                .max(java.util.Comparator.comparing(OrchCredential::getId)).orElse(null);
    }
}
