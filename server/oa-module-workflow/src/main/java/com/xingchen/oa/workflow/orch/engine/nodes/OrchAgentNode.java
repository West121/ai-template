package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.engine.script.ScriptContext;
import com.xingchen.oa.workflow.engine.script.ScriptService;
import com.xingchen.oa.workflow.llm.LlmToolLoop;
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
 * agent 节点（§9.1 AI Agent）：function-calling 循环走公共 {@link LlmToolLoop}
 * （与 AI 智能助手同源基建）。config {credentialId, model?, systemPrompt?, userPrompt,
 * tools:[{name,description,params:[{name,type,description,required}],
 * impl:{kind:"HTTP",method,url,headers?,body?} | {kind:"SCRIPT",script:{lang,code}}}],
 * maxSteps(默认8,≤15), timeoutMs(整体,默认120s), outputMode TEXT|JSON, saveAs}。
 * HTTP 工具模板上下文=编排上下文+{{args.xxx}}；SCRIPT 绑定 vars.args。
 * 节点输出 {result, steps[], warning?}（steps 进留痕）。
 */
public class OrchAgentNode extends OrchBaseNode {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();

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
        String model = StringUtils.hasText(config.path("model").asString(null))
                ? config.path("model").asString(null) : cred.getModel();
        String outputMode = config.path("outputMode").asString("TEXT").toUpperCase();

        // 工具 schema + 名称索引
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
                props.put(param.path("name").asString(""), Map.of(
                        "type", param.path("type").asString("string"),
                        "description", param.path("description").asString("")));
                if (param.path("required").asBoolean(false)) {
                    required.add(param.path("name").asString(""));
                }
            }
            toolSchemas.add(LlmToolLoop.toolSchema(name, tool.path("description").asString(""), props, required));
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

        LlmToolLoop.Config loopCfg = new LlmToolLoop.Config(cred.getBaseUrl(), apiKey, model,
                config.hasNonNull("temperature") ? config.path("temperature").asDouble() : null,
                config.hasNonNull("maxTokens") ? config.path("maxTokens").asInt() : null,
                config.path("maxSteps").asInt(8),
                Math.min(config.path("timeoutMs").asLong(120_000), 600_000));
        LlmToolLoop.Result loop = LlmToolLoop.run(loopCfg, messages, toolSchemas,
                (toolName, args) -> executeTool(ctx, toolByName.get(toolName), args, mapper, tpl), mapper);

        Object result = loop.content();
        if ("JSON".equals(outputMode) && loop.content() != null) {
            try {
                result = mapper.readValue(stripFences(loop.content()), Map.class);
            } catch (Exception e) {
                throw new IllegalStateException("agent JSON 输出解析失败: " + e.getMessage());
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("result", result);
        out.put("steps", loop.steps());
        if (loop.warning() != null) {
            out.put("warning", loop.warning());
        }
        return out;
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
