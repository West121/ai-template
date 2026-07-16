package com.hentor.oa.boot.ai.tool;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AI 助手工具注册表（V2 批B）：启动扫描全部 Spring bean 的 {@link AiToolDefinition} 方法，
 * 维护 规范名 → 工具 与 别名 → 规范名 映射；提供 Spring AI ToolDefinition inputSchema 与原始反射执行。
 * 策略（上下文断言/权限/风险/超时/审计）在 {@link AiToolGateway}，暴露过滤在 {@link AuthorizedToolResolver}。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ToolRegistry {

    private final ApplicationContext applicationContext;
    private final ObjectMapper objectMapper;

    private final Map<String, RegisteredTool> tools = new LinkedHashMap<>();
    private final Map<String, String> aliases = new LinkedHashMap<>();

    /** 已注册工具（def=声明元数据；inputSchema=Spring AI ToolDefinition JSON）。 */
    public record RegisteredTool(Object bean, Method method, AiToolDefinition def, String inputSchema) {
    }

    @PostConstruct
    public void scan() {
        for (Object bean : applicationContext.getBeansOfType(Object.class).values()) {
            Class<?> clazz = AopUtils.getTargetClass(bean);
            if (!clazz.getPackageName().startsWith("com.hentor.oa.boot.ai")) {
                continue; // 只扫助手工具包，避免全量反射
            }
            for (Method m : clazz.getMethods()) {
                AiToolDefinition def = m.getAnnotation(AiToolDefinition.class);
                if (def == null) {
                    continue;
                }
                tools.put(def.name(), new RegisteredTool(bean, m, def, buildInputSchema(def)));
                for (String alias : def.aliases()) {
                    aliases.put(alias, def.name());
                }
            }
        }
        log.info("AI 助手工具注册完成：{} 个 [{}]（别名 {} 个）",
                tools.size(), String.join(", ", tools.keySet()), aliases.size());
    }

    /** 别名 → 规范名（未知名原样返回，由 Gateway 判未注册）。 */
    public String canonicalName(String name) {
        if (name == null) {
            return null;
        }
        return tools.containsKey(name) ? name : aliases.getOrDefault(name, name);
    }

    public RegisteredTool get(String canonicalName) {
        return tools.get(canonicalName);
    }

    public List<RegisteredTool> all() {
        return new ArrayList<>(tools.values());
    }

    /** 原始反射执行（策略校验在 Gateway；异常原样抛出由 Gateway 统一转错误帧）。 */
    public ToolResult invoke(RegisteredTool tool, Map<String, Object> args) throws Exception {
        return (ToolResult) tool.method().invoke(tool.bean(), args);
    }

    /** Spring AI ToolDefinition.inputSchema：{"type":"object","properties":...,"required":[...]}。 */
    @SuppressWarnings("unchecked")
    private String buildInputSchema(AiToolDefinition def) {
        try {
            Map<String, Object> props = objectMapper.readValue(def.paramsSchema(), Map.class);
            Map<String, Object> schema = new LinkedHashMap<>();
            schema.put("type", "object");
            schema.put("properties", props);
            schema.put("required", List.of(def.required()));
            return objectMapper.writeValueAsString(schema);
        } catch (Exception e) {
            log.warn("AI 工具 {} paramsSchema 解析失败: {}", def.name(), e.getMessage());
            return "{\"type\":\"object\",\"properties\":{},\"required\":[]}";
        }
    }
}
