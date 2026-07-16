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
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * HTTP 节点：config {method,url,headers,body,timeoutMs,responseType JSON|TEXT,credentialId?,saveAs}。
 * url/headers/body 模板插值；credentialId 按凭据类型注入认证头（HTTP_BEARER/HTTP_BASIC/HTTP_HEADER）。
 * 状态码 ≥400 视为失败（触发 retry/onError）。输出 {status, body}。
 */
public class OrchHttpNode extends OrchBaseNode {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();

    @Override
    protected Object inputSummary(OrchRunContext ctx, JsonNode node, JsonNode config) {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        Map<String, Object> in = new LinkedHashMap<>();
        in.put("method", config.path("method").asString("GET"));
        in.put("url", tpl.renderString(config.path("url").asString(""), ctx.evalCtx()));
        if (config.hasNonNull("body")) {
            in.put("body", tpl.render(config.path("body").asString(""), ctx.evalCtx()));
        }
        return in;
    }

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) throws Exception {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        ObjectMapper mapper = OrchSpringHolder.bean(ObjectMapper.class);
        Map<String, Object> evalCtx = ctx.evalCtx();

        String method = config.path("method").asString("GET").toUpperCase();
        String url = tpl.renderString(config.path("url").asString(""), evalCtx);
        if (!StringUtils.hasText(url)) {
            throw new IllegalStateException("http 节点缺少 url");
        }
        long timeoutMs = Math.max(1000, Math.min(config.path("timeoutMs").asLong(10_000), 120_000));

        HttpRequest.Builder rb = HttpRequest.newBuilder().uri(URI.create(url))
                .timeout(Duration.ofMillis(timeoutMs));
        for (Map.Entry<String, JsonNode> e : config.path("headers").properties()) {
            rb.header(e.getKey(), tpl.renderString(e.getValue().asString(""), evalCtx));
        }
        applyCredential(rb, config);

        if ("GET".equals(method) || "DELETE".equals(method)) {
            rb.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            Object body = config.hasNonNull("body")
                    ? tpl.render(config.path("body").asString(""), evalCtx) : null;
            String bodyStr = body == null ? ""
                    : (body instanceof String s ? s : mapper.writeValueAsString(body));
            if (config.path("headers").path("Content-Type").isMissingNode()) {
                rb.header("Content-Type", "application/json");
            }
            rb.method(method, HttpRequest.BodyPublishers.ofString(bodyStr, StandardCharsets.UTF_8));
        }

        HttpResponse<String> resp = CLIENT.send(rb.build(), HttpResponse.BodyHandlers.ofString());
        String responseType = config.path("responseType").asString("JSON").toUpperCase();
        Object bodyOut = resp.body();
        if (!"TEXT".equals(responseType)) {
            try {
                bodyOut = mapper.readValue(resp.body(), Map.class);
            } catch (Exception ignored) {
                // 非 JSON 响应按原文（宽松：JSON 模式解析失败不判节点失败，判失败交给状态码）
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", resp.statusCode());
        out.put("body", bodyOut);
        if (resp.statusCode() >= 400) {
            throw new IllegalStateException("HTTP " + resp.statusCode() + ": "
                    + (resp.body() == null ? "" : resp.body().substring(0, Math.min(200, resp.body().length()))));
        }
        return out;
    }

    /** 按凭据类型注入认证头（P0 通用凭据）。 */
    private void applyCredential(HttpRequest.Builder rb, JsonNode config) {
        long credentialId = config.path("credentialId").asLong(0);
        if (credentialId <= 0) {
            return;
        }
        OrchCredential cred = OrchSpringHolder.bean(OrchCredentialRepository.class)
                .findById(credentialId).orElse(null);
        if (cred == null || !Boolean.TRUE.equals(cred.getEnabled())) {
            throw new IllegalStateException("凭据不存在或已停用: " + credentialId);
        }
        String key = OrchSpringHolder.bean(OrchCipher.class).decrypt(cred.getApiKeyEnc());
        switch (cred.getType()) {
            case OrchCredential.TYPE_HTTP_BEARER, OrchCredential.TYPE_LLM ->
                    rb.header("Authorization", "Bearer " + key);
            case OrchCredential.TYPE_HTTP_BASIC -> rb.header("Authorization",
                    "Basic " + Base64.getEncoder().encodeToString(key.getBytes(StandardCharsets.UTF_8)));
            case OrchCredential.TYPE_HTTP_HEADER -> rb.header(
                    StringUtils.hasText(cred.getHeaderName()) ? cred.getHeaderName() : "X-Api-Key", key);
            default -> throw new IllegalStateException("不支持的凭据类型: " + cred.getType());
        }
    }
}
