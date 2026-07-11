package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.entity.AiToolCall;
import com.xingchen.oa.boot.ai.repository.AiToolCallRepository;
import com.xingchen.oa.boot.ai.support.AiErrors;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.workflow.llm.LlmToolLoop;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.lang.reflect.Method;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * AI 助手工具注册表（§4）：启动扫描全部 Spring bean 的 {@code @AiTool} 方法，
 * 生成 OpenAI function schema 给 LLM；执行统一入口。
 * 工具实现一律包装既有 Service —— @PreAuthorize 功能权限与 JPA 数据权限天然生效（安全红线 §0.1）。
 *
 * <p>V2 批A：
 * <ul>
 *   <li><b>上下文断言（附2 第 2 条）</b>：SSE 异步执行下工具入口硬校验 UserContext 存在，缺失即拒——
 *       防止上下文传播缺口导致以匿名/串用身份执行业务；</li>
 *   <li><b>ai_tool_call 审计</b>：名称/参数哈希+脱敏截断摘要/结果摘要/耗时/risk 占位 READ_ONLY
 *       （批B @AiToolDefinition 落真值），best-effort 落库不阻断工具执行。</li>
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ToolRegistry {

    private final ApplicationContext applicationContext;
    private final ObjectMapper objectMapper;
    private final AiToolCallRepository toolCallRepository;
    private final AiSessionHolder sessionHolder;

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

    public ToolResult execute(String name, Map<String, Object> args) {
        return execute("tc_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12), name, args);
    }

    /**
     * 统一执行入口：上下文断言 → 反射执行 → 审计落库；异常转 error 数据帧
     * （403/无权限以文本告知 LLM，由助手礼貌解释——不中断对话）。
     */
    public ToolResult execute(String toolCallId, String name, Map<String, Object> args) {
        // 附2 第 2 条：异步执行上下文必须显式传播——工具入口断言，缺失即拒执行
        UserContext user = CurrentUserHolder.get();
        if (user == null) {
            log.error("AI 工具调用被拒：执行上下文缺失 tool={}（异步上下文传播缺口）", name);
            return ToolResult.of("{\"error\":\"" + AiErrors.CONTEXT_MISSING + ": 执行上下文缺失，已拒绝执行\"}");
        }
        Registered reg = tools.get(name);
        if (reg == null) {
            audit(toolCallId, name, args, null, AiToolCall.STATUS_FAILED, 0, AiErrors.TOOL_NOT_ALLOWED, user);
            return ToolResult.of("{\"error\":\"未知工具: " + name + "\"}");
        }
        long start = System.currentTimeMillis();
        try {
            ToolResult result = (ToolResult) reg.method().invoke(reg.bean(), args);
            long cost = System.currentTimeMillis() - start;
            log.info("AI 工具调用 {} args={} cost={}ms", name, safeArgs(args), cost);
            audit(toolCallId, name, args, result.llmContent(), AiToolCall.STATUS_SUCCEEDED, cost, null, user);
            return result;
        } catch (Exception e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            long cost = System.currentTimeMillis() - start;
            log.info("AI 工具调用失败 {} args={} cost={}ms err={}", name, safeArgs(args), cost, cause.getMessage());
            audit(toolCallId, name, args, cause.getMessage(), AiToolCall.STATUS_FAILED, cost, "EXECUTE_ERROR", user);
            return ToolResult.of("{\"error\":\"" + String.valueOf(cause.getMessage()).replace("\"", "'") + "\"}");
        }
    }

    /** §14.4 审计落库（best-effort）：参数哈希 + 脱敏截断摘要 + 结果摘要 + 耗时 + risk 占位 READ_ONLY。 */
    private void audit(String toolCallId, String name, Map<String, Object> args, String resultText,
                       String status, long costMs, String errorCode, UserContext user) {
        try {
            AiSessionHolder.Turn turn = sessionHolder.currentTurn();
            String argsJson = safeArgs(args);
            AiToolCall row = new AiToolCall();
            row.setTenantId(AiErrors.TENANT_DEFAULT);
            row.setUserId(user.getUserId());
            row.setSessionId(turn != null ? turn.sessionId() : null);
            row.setMessageId(turn != null ? turn.messageId() : null);
            row.setToolCallId(toolCallId);
            row.setToolName(name);
            row.setRiskLevel("READ_ONLY"); // 批A 占位；批B @AiToolDefinition(risk) 落真值
            row.setArgumentsHash(AiErrors.sha256(argsJson));
            row.setArgumentsSummary(truncate(argsJson, 500));
            row.setResultSummary(truncate(resultText, 500));
            row.setStatus(status);
            row.setDurationMs(costMs);
            row.setRequestId(turn != null ? turn.requestId() : null);
            row.setTraceId(turn != null ? turn.traceId() : null);
            row.setErrorCode(errorCode);
            row.setCompletedAt(OffsetDateTime.now());
            toolCallRepository.save(row);
        } catch (Exception e) {
            log.warn("ai_tool_call 审计落库失败（不阻断）: {}", e.getMessage());
        }
    }

    private String truncate(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() > max ? s.substring(0, max) : s;
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
