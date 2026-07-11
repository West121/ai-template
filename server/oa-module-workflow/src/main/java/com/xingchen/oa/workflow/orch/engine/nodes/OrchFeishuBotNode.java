package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.engine.OrchTemplate;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 飞书机器人节点（§9.5）：config {url(自定义机器人webhook), secret?(签名校验), msgType "text"|"markdown",
 * title?(markdown 用), content(模板)}。
 * 签名：timestamp+"\n"+secret 作 HmacSHA256 密钥、空串为数据 → Base64，随 body 携带 timestamp/sign。
 * text → msg_type=text；markdown → msg_type=post（富文本单段落，MVP 语义）。
 * 响应 code!=0（新版）/ StatusCode!=0（旧版）视为失败。输出 {status, body}。
 */
public class OrchFeishuBotNode extends OrchBaseNode {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) throws Exception {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        ObjectMapper mapper = OrchSpringHolder.bean(ObjectMapper.class);
        Map<String, Object> evalCtx = ctx.evalCtx();

        String url = config.path("url").asString(null);
        if (!StringUtils.hasText(url)) {
            throw new IllegalStateException("feishuBot 缺少 url");
        }
        String content = tpl.renderString(config.path("content").asString(""), evalCtx);
        String msgType = config.path("msgType").asString("text").toLowerCase();

        Map<String, Object> msg = new LinkedHashMap<>();
        String secret = config.path("secret").asString(null);
        if (StringUtils.hasText(secret)) {
            long ts = System.currentTimeMillis() / 1000;
            msg.put("timestamp", String.valueOf(ts));
            msg.put("sign", sign(ts, secret));
        }
        if ("markdown".equals(msgType)) {
            String title = tpl.renderString(config.path("title").asString("通知"), evalCtx);
            msg.put("msg_type", "post");
            msg.put("content", Map.of("post", Map.of("zh_cn", Map.of(
                    "title", title,
                    "content", List.of(List.of(Map.of("tag", "text", "text", content)))))));
        } else {
            msg.put("msg_type", "text");
            msg.put("content", Map.of("text", content));
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
            Object code = parsed.containsKey("code") ? parsed.get("code") : parsed.get("StatusCode");
            if (code instanceof Number n && n.intValue() != 0) {
                throw new IllegalStateException("飞书机器人返回 code=" + n + ": " + parsed.get("msg"));
            }
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception ignored) {
            // 非 JSON 响应按原文
        }
        if (resp.statusCode() >= 400) {
            throw new IllegalStateException("飞书机器人 HTTP " + resp.statusCode());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", resp.statusCode());
        out.put("body", body);
        return out;
    }

    /** 飞书加签：以 timestamp+"\n"+secret 为密钥、空数据做 HmacSHA256 → Base64。 */
    private String sign(long timestamp, String secret) throws Exception {
        String key = timestamp + "\n" + secret;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return Base64.getEncoder().encodeToString(mac.doFinal(new byte[0]));
    }
}
