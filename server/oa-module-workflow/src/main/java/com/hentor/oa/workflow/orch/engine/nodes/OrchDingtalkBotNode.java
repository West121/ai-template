package com.hentor.oa.workflow.orch.engine.nodes;

import com.hentor.oa.workflow.orch.engine.OrchRunContext;
import com.hentor.oa.workflow.orch.engine.OrchSpringHolder;
import com.hentor.oa.workflow.orch.engine.OrchTemplate;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 钉钉机器人节点（§9.5）：config {url(机器人webhook), secret?(加签), msgType "text"|"markdown",
 * title?(markdown 用), content(模板), atMobiles?[], atAll?}。
 * 加签：timestamp+"\n"+secret → HmacSHA256 → Base64 → URLEncode，追加 &timestamp&sign。
 * 响应 errcode!=0 视为失败（走 retry/onError）。输出 {status, body}。
 */
public class OrchDingtalkBotNode extends OrchBaseNode {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) throws Exception {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        ObjectMapper mapper = OrchSpringHolder.bean(ObjectMapper.class);
        Map<String, Object> evalCtx = ctx.evalCtx();

        String url = config.path("url").asString(null);
        if (!StringUtils.hasText(url)) {
            throw new IllegalStateException("dingtalkBot 缺少 url");
        }
        String secret = config.path("secret").asString(null);
        if (StringUtils.hasText(secret)) {
            long ts = System.currentTimeMillis();
            String sign = sign(ts + "\n" + secret, secret);
            url += (url.contains("?") ? "&" : "?") + "timestamp=" + ts + "&sign="
                    + URLEncoder.encode(sign, StandardCharsets.UTF_8);
        }

        String msgType = config.path("msgType").asString("text").toLowerCase();
        String content = tpl.renderString(config.path("content").asString(""), evalCtx);
        Map<String, Object> msg = new LinkedHashMap<>();
        if ("markdown".equals(msgType)) {
            msg.put("msgtype", "markdown");
            msg.put("markdown", Map.of(
                    "title", tpl.renderString(config.path("title").asString("通知"), evalCtx),
                    "text", content));
        } else {
            msg.put("msgtype", "text");
            msg.put("text", Map.of("content", content));
        }
        List<String> atMobiles = new ArrayList<>();
        config.path("atMobiles").forEach(m -> atMobiles.add(m.asString("")));
        if (!atMobiles.isEmpty() || config.path("atAll").asBoolean(false)) {
            msg.put("at", Map.of("atMobiles", atMobiles, "isAtAll", config.path("atAll").asBoolean(false)));
        }

        HttpResponse<String> resp = CLIENT.send(HttpRequest.newBuilder().uri(URI.create(url))
                        .timeout(Duration.ofSeconds(15))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(msg), StandardCharsets.UTF_8))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        Object body = resp.body();
        try {
            Map<String, Object> parsed = mapper.readValue(resp.body(), Map.class);
            body = parsed;
            Object errcode = parsed.get("errcode");
            if (errcode instanceof Number n && n.intValue() != 0) {
                throw new IllegalStateException("钉钉机器人返回 errcode=" + n + ": " + parsed.get("errmsg"));
            }
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception ignored) {
            // 非 JSON 响应按原文
        }
        if (resp.statusCode() >= 400) {
            throw new IllegalStateException("钉钉机器人 HTTP " + resp.statusCode());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", resp.statusCode());
        out.put("body", body);
        return out;
    }

    private String sign(String data, String secret) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return Base64.getEncoder().encodeToString(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
    }
}
