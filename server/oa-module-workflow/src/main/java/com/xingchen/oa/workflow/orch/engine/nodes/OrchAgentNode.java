package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.engine.script.ScriptContext;
import com.xingchen.oa.workflow.engine.script.ScriptService;
import com.xingchen.oa.workflow.orch.engine.OrchCipher;
import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.engine.OrchTemplate;
import com.xingchen.oa.workflow.orch.entity.OrchCredential;
import com.xingchen.oa.workflow.orch.repository.OrchCredentialRepository;
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
 * agent 节点（§9.1 AI Agent，OpenAI function-calling 循环）：
 * config {credentialId, model?, systemPrompt?, userPrompt, tools:[{name,description,params:[{name,type,description,required}],
 * impl:{kind:"HTTP",method,url,headers?,body?} | {kind:"SCRIPT",script:{lang,code}}}], maxSteps(默认8,≤15),
 * timeoutMs(整体,默认120s), outputMode TEXT|JSON, saveAs}。
 *
 * <p>循环：messages 累积 → LLM 返回 tool_calls → 逐个执行工具（HTTP 模板可用 {{args.xxx}} 引用实参；
 * SCRIPT 绑定 args）→ role:tool 回填 → 直至无 tool_calls 或超 maxSteps（记 warning 取最后 assistant 内容）。
 * 节点输出 {result, steps[], warning?}，steps=每步 {step, tool, args, result(摘要500字)}。凭据/协议同 llm。
 */
public class OrchAgentNode extends OrchBaseNode {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();
    private static final int HARD_MAX_STEPS = 15;

    @Override
    protected Object inputSummary(OrchRunContext ctx, JsonNode node, JsonNode config) {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        Map<String, Object> in = new LinkedHashMap<>();
        in.put("credentialId", config.path("credentialId").asLong(0));
        in.put("tools", config.path("tools").size());
        in.put("maxSteps", config.path("maxSteps").asInt(8));
        in.put("userPrompt", tpl.renderString(config.path("userPrompt").asString(""), ctx.evalCtx()));
        return in;
    }

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) throws Exception {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        ObjectMapper mapper = OrchSpringHolder.bean(ObjectMapper.class);
        Map<String, Object> evalCtx = ctx.evalCtx();

        OrchCredential cred = OrchSpringHolder.bean(OrchCredentialRepository.class)
                .findById(config.path("credentialId").asLong(0)).orElse(null);
        if (cred == null || !Boolean.TRUE.equals(cred.getEnabled()) || !StringUtils.hasText(cred.getBaseUrl())) {
            throw new IllegalStateException("agent 凭据不存在/停用/缺 baseUrl");
        }
        String apiKey = OrchSpringHolder.bean(OrchCipher.class).decrypt(cred.getApiKeyEnc());
        String endpoint = cred.getBaseUrl().replaceAll("/+$", "") + "/chat/completions";
        String model = StringUtils.hasText(config.path("model").asString(null))
                ? config.path("model").asString(null) : cred.getModel();
        int maxSteps = Math.max(1, Math.min(config.path("maxSteps").asInt(8), HARD_MAX_STEPS));
        long deadline = System.currentTimeMillis()
                + Math.max(5_000, Math.min(config.path("timeoutMs").asLong(120_000), 600_000));
        String outputMode = config.path("outputMode").asString("TEXT").toUpperCase();

        // OpenAI tools schema（内嵌定义 → function-calling 声明）
        List<Map<String, Object>> toolSchemas = new ArrayList<>();
        Map<String, JsonNode> toolByName = new LinkedHashMap<>();
        for (JsonNode tool : config.path("tools")) {
            String name = tool.path("name").asString(null);
            if (!StringUtils.hasText(name)) {
                continue;
            }
            toolByName.put(name, tool);
            Map<String, Object> props = new LinkedHashMap<>();
            List<String> required = new ArrayList<>();
            for (JsonNode param : tool.path("params")) {
                Map<String, Object> ps = new LinkedHashMap<>();
                ps.put("type", param.path("type").asString("string"));
                ps.put("description", param.path("description").asString(""));
                props.put(param.path("name").asString(""), ps);
                if (param.path("required").asBoolean(false)) {
                    required.add(param.path("name").asString(""));
                }
            }
            toolSchemas.add(Map.of("type", "function", "function", Map.of(
                    "name", name,
                    "description", tool.path("description").asString(""),
                    "parameters", Map.of("type", "object", "properties", props, "required", required))));
        }

        List<Map<String, Object>> messages = new ArrayList<>();
        String system = tpl.renderString(config.path("systemPrompt").asString(null), evalCtx);
        if ("JSON".equals(outputMode)) {
            String hint = "最终回答必须只输出一个合法 JSON 对象，不含其他文字或 markdown 代码块。";
            system = StringUtils.hasText(system) ? system + "\n" + hint : hint;
        }
        if (StringUtils.hasText(system)) {
            messages.add(Map.of("role", "system", "content", system));
        }
        messages.add(Map.of("role", "user",
                "content", String.valueOf(tpl.renderString(config.path("userPrompt").asString(""), evalCtx))));

        List<Map<String, Object>> steps = new ArrayList<>();
        String warning = null;
        String finalContent = null;
        for (int step = 1; step <= maxSteps; step++) {
            long remain = deadline - System.currentTimeMillis();
            if (remain <= 0) {
                throw new IllegalStateException("agent 整体超时");
            }
            Map<String, Object> req = new LinkedHashMap<>();
            req.put("model", model);
            req.put("messages", messages);
            if (!toolSchemas.isEmpty()) {
                req.put("tools", toolSchemas);
            }
            JsonNode message = chat(endpoint, apiKey, mapper.writeValueAsString(req), remain, mapper);

            JsonNode toolCalls = message.path("tool_calls");
            if (!toolCalls.isArray() || toolCalls.isEmpty()) {
                finalContent = message.path("content").asString(null);
                break;
            }
            // assistant(tool_calls) 消息回填
            Map<String, Object> assistantMsg = new LinkedHashMap<>();
            assistantMsg.put("role", "assistant");
            assistantMsg.put("content", message.path("content").isNull() ? null : message.path("content").asString(null));
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
                    result = executeTool(ctx, toolByName.get(toolName), args, mapper, tpl);
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

        Object result = finalContent;
        if ("JSON".equals(outputMode) && finalContent != null) {
            try {
                result = mapper.readValue(stripFences(finalContent), Map.class);
            } catch (Exception e) {
                throw new IllegalStateException("agent JSON 输出解析失败: " + e.getMessage());
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("result", result);
        out.put("steps", steps);
        if (warning != null) {
            out.put("warning", warning);
        }
        return out;
    }

    /** 调 OpenAI-compatible /chat/completions，返回 choices[0].message。 */
    private JsonNode chat(String endpoint, String apiKey, String body, long timeoutMs, ObjectMapper mapper)
            throws Exception {
        HttpRequest req = HttpRequest.newBuilder().uri(URI.create(endpoint))
                .timeout(Duration.ofMillis(Math.min(timeoutMs, 120_000)))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> resp = CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() >= 400) {
            throw new IllegalStateException("agent LLM HTTP " + resp.statusCode() + ": "
                    + resp.body().substring(0, Math.min(200, resp.body().length())));
        }
        JsonNode message = mapper.readTree(resp.body()).path("choices").path(0).path("message");
        if (message.isMissingNode()) {
            throw new IllegalStateException("agent LLM 响应缺少 choices[0].message");
        }
        return message;
    }

    /** 执行内嵌工具：HTTP（模板上下文含 args）/ SCRIPT（vars 绑定 args）。返回喂回 LLM 的字符串。 */
    private String executeTool(OrchRunContext ctx, JsonNode tool, Map<String, Object> args,
                               ObjectMapper mapper, OrchTemplate tpl) throws Exception {
        if (tool == null) {
            return "{\"error\":\"unknown tool\"}";
        }
        JsonNode impl = tool.path("impl");
        String kind = impl.path("kind").asString("HTTP").toUpperCase();
        if ("SCRIPT".equals(kind)) {
            Map<String, Object> vars = new LinkedHashMap<>();
            vars.put("args", args);
            Map<String, Object> form = new LinkedHashMap<>();
            form.put("payload", ctx.payload);
            form.put("outputs", ctx.outputs);
            Object r = OrchSpringHolder.bean(ScriptService.class).run(
                    impl.path("script").path("lang").asString("groovy"),
                    impl.path("script").path("code").asString(""),
                    new ScriptContext(vars, form, null, "orch-agent-tool:" + tool.path("name").asString("")));
            return r instanceof String str ? str : mapper.writeValueAsString(r);
        }
        // HTTP：模板上下文 = 编排上下文 + args
        Map<String, Object> toolCtx = new LinkedHashMap<>(ctx.evalCtx());
        toolCtx.put("args", args);
        String url = tpl.renderString(impl.path("url").asString(""), toolCtx);
        String method = impl.path("method").asString("GET").toUpperCase();
        HttpRequest.Builder rb = HttpRequest.newBuilder().uri(URI.create(url)).timeout(Duration.ofSeconds(30));
        for (Map.Entry<String, JsonNode> h : impl.path("headers").properties()) {
            rb.header(h.getKey(), tpl.renderString(h.getValue().asString(""), toolCtx));
        }
        if ("GET".equals(method) || "DELETE".equals(method)) {
            rb.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            Object body = impl.hasNonNull("body") ? tpl.render(impl.path("body").asString(""), toolCtx) : null;
            String bodyStr = body == null ? "" : (body instanceof String bs ? bs : mapper.writeValueAsString(body));
            rb.header("Content-Type", "application/json");
            rb.method(method, HttpRequest.BodyPublishers.ofString(bodyStr, StandardCharsets.UTF_8));
        }
        HttpResponse<String> resp = CLIENT.send(rb.build(), HttpResponse.BodyHandlers.ofString());
        return resp.body() == null ? ("HTTP " + resp.statusCode()) : resp.body();
    }

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
