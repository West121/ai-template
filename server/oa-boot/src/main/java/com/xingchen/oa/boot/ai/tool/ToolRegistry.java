package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.workflow.llm.LlmToolLoop;
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
 * AI 助手工具注册表（§4）：启动扫描全部 Spring bean 的 {@code @AiTool} 方法，
 * 生成 OpenAI function schema 给 LLM；执行统一入口带调用留痕（名称/参数/结果摘要/耗时）。
 * 工具实现一律包装既有 Service —— @PreAuthorize 功能权限与 JPA 数据权限天然生效（安全红线 §0.1）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ToolRegistry {

    private final ApplicationContext applicationContext;
    private final ObjectMapper objectMapper;

    private final Map<String, Registered> tools = new LinkedHashMap<>();
    private final List<Map<String, Object>> schemas = new ArrayList<>();

    private record Registered(Object bean, Method method, AiTool meta) {
    }

    @PostConstruct
    public void scan() {
        for (Object bean : applicationContext.getBeansOfType(Object.class).values()) {
            Class<?> clazz = AopUtils.getTargetClass(bean);
            if (!clazz.getPackageName().startsWith("com.xingchen.oa.boot.ai")) {
                continue; // 只扫助手工具包，避免全量反射
            }
            for (Method m : clazz.getMethods()) {
                AiTool meta = m.getAnnotation(AiTool.class);
                if (meta == null) {
                    continue;
                }
                tools.put(meta.name(), new Registered(bean, m, meta));
                try {
                    Map<String, Object> props = objectMapper.readValue(meta.paramsSchema(), Map.class);
                    schemas.add(LlmToolLoop.toolSchema(meta.name(), meta.description(),
                            props, List.of(meta.required())));
                } catch (Exception e) {
                    log.warn("AI 工具 {} paramsSchema 解析失败: {}", meta.name(), e.getMessage());
                }
            }
        }
        log.info("AI 助手工具注册完成：{} 个 [{}]", tools.size(), String.join(", ", tools.keySet()));
    }

    public List<Map<String, Object>> schemas() {
        return schemas;
    }

    /**
     * 统一执行入口（请求线程内，UserContext 生效）：留痕 + 异常转 error 数据帧
     * （403/无权限以文本告知 LLM，由助手礼貌解释——不中断对话）。
     */
    public ToolResult execute(String name, Map<String, Object> args) {
        Registered reg = tools.get(name);
        if (reg == null) {
            return ToolResult.of("{\"error\":\"未知工具: " + name + "\"}");
        }
        long start = System.currentTimeMillis();
        try {
            ToolResult result = (ToolResult) reg.method().invoke(reg.bean(), args);
            log.info("AI 工具调用 {} args={} cost={}ms", name, safeArgs(args), System.currentTimeMillis() - start);
            return result;
        } catch (Exception e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            log.info("AI 工具调用失败 {} args={} cost={}ms err={}", name, safeArgs(args),
                    System.currentTimeMillis() - start, cause.getMessage());
            return ToolResult.of("{\"error\":\"" + String.valueOf(cause.getMessage()).replace("\"", "'") + "\"}");
        }
    }

    private String safeArgs(Map<String, Object> args) {
        try {
            String s = objectMapper.writeValueAsString(args);
            return s.length() > 300 ? s.substring(0, 300) : s;
        } catch (Exception e) {
            return String.valueOf(args);
        }
    }
}
