package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.entity.AiToolCall;
import com.xingchen.oa.boot.ai.repository.AiToolCallRepository;
import com.xingchen.oa.boot.ai.service.AiPermissionExplainer;
import com.xingchen.oa.boot.ai.support.AiErrors;
import com.xingchen.oa.boot.ai.support.AiExecutionContext;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * 工具网关（ai-assistant-design-v2.md §6.1，批B）：模型工具调用的统一执行闸口。
 *
 * <ol>
 *   <li><b>上下文断言</b>（附2 第 2 条）：UserContext 缺失即拒；</li>
 *   <li><b>别名解析</b>：V1 旧名 → 规范名（旧名不暴露给模型，调用兼容执行）；</li>
 *   <li><b>权限/风险复验</b>：Resolver 过滤只是暴露面，执行入口再验（伪造/越权工具名 →
 *       结构化 403：missingAuthority + holderRoles + adminHint，亮点②）；</li>
 *   <li><b>参数 Schema 校验</b>：required 缺失 → AI_TOOL_INVALID_ARGUMENT；</li>
 *   <li><b>超时</b>：@AiToolDefinition.timeoutSeconds，虚拟线程 + 上下文传播执行，超时 AI_TOOL_TIMEOUT；</li>
 *   <li><b>结果最小化</b>：喂回模型的数据帧截断（§19.3 敏感最小化的传输面）；</li>
 *   <li><b>审计</b>：ai_tool_call 落库（risk 真实值/参数哈希+脱敏摘要/结果摘要/耗时）。</li>
 * </ol>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiToolGateway {

    /** 喂回模型的单工具结果上限（字符）——大数据走卡片/数据集，不塞上下文。 */
    private static final int MAX_LLM_CONTENT = 8_000;

    private final ToolRegistry registry;
    private final AiToolCallRepository toolCallRepository;
    private final AiSessionHolder sessionHolder;
    private final AiPermissionExplainer permissionExplainer;
    private final ObjectMapper objectMapper;
    /** AiAsyncConfig 虚拟线程执行器（超时控制用；按参数名匹配 bean aiExecutor）。 */
    private final ExecutorService aiExecutor;

    /**
     * 统一执行入口。永不抛出——一切异常转 error 数据帧（模型礼貌解释，不中断对话）。
     */
    public ToolResult execute(String toolCallId, String requestedName, Map<String, Object> args) {
        // ① 上下文断言：异步链路传播缺口 → 拒执行
        UserContext user = CurrentUserHolder.get();
        if (user == null) {
            log.error("AI 工具调用被拒：执行上下文缺失 tool={}（异步上下文传播缺口）", requestedName);
            return errorFrame(AiErrors.CONTEXT_MISSING, "执行上下文缺失，已拒绝执行", null);
        }
        // ② 别名解析（旧名兼容）
        String canonical = registry.canonicalName(requestedName);
        ToolRegistry.RegisteredTool tool = registry.get(canonical);
        if (tool == null) {
            // 伪造/幻觉工具名：礼貌拒绝 + error 卡（不中断对话）
            audit(toolCallId, requestedName, "READ_ONLY", args, null,
                    AiToolCall.STATUS_FAILED, 0, AiErrors.TOOL_NOT_ALLOWED, user);
            Map<String, Object> card = errorCard(AiErrors.TOOL_NOT_ALLOWED,
                    "该操作不在可用工具范围内: " + requestedName, null);
            return ToolResult.of(toJson(Map.of("error",
                    AiErrors.TOOL_NOT_ALLOWED + ": 未知工具 " + requestedName)), card);
        }
        AiToolDefinition def = tool.def();
        String risk = def.risk().name();
        // ③ 风险/权限复验（Resolver 之外的第二道门；亮点② 结构化 403 解释）
        if (def.risk() == AiToolRisk.PROHIBITED) {
            audit(toolCallId, canonical, risk, args, null, AiToolCall.STATUS_FAILED, 0,
                    AiErrors.TOOL_NOT_ALLOWED, user);
            return ToolResult.of(toJson(Map.of("error", AiErrors.TOOL_NOT_ALLOWED + ": 该工具不向 AI 开放")),
                    errorCard(AiErrors.TOOL_NOT_ALLOWED, "该操作不向 AI 助手开放", null));
        }
        String missing = firstMissingAuthority(user, def);
        if (missing != null) {
            Map<String, Object> explain = permissionExplainer.explain(missing);
            audit(toolCallId, canonical, risk, args, null, AiToolCall.STATUS_FAILED, 0,
                    AiErrors.TOOL_NOT_ALLOWED, user);
            Map<String, Object> card = errorCard(AiErrors.TOOL_NOT_ALLOWED,
                    "当前身份缺少权限，无法执行「" + def.description().split("[。（(]")[0] + "」", explain);
            return ToolResult.of(toJson(Map.of(
                    "error", AiErrors.TOOL_NOT_ALLOWED + ": 缺少权限 " + missing,
                    "missingAuthority", missing,
                    "holderRoles", explain.getOrDefault("holderRoles", List.of()))), card);
        }
        // ④ 参数 Schema 校验（required）
        for (String req : def.required()) {
            Object v = args == null ? null : args.get(req);
            if (v == null || String.valueOf(v).isBlank()) {
                audit(toolCallId, canonical, risk, args, null, AiToolCall.STATUS_FAILED, 0,
                        AiErrors.TOOL_INVALID_ARGUMENT, user);
                return errorFrame(AiErrors.TOOL_INVALID_ARGUMENT, "缺少必填参数: " + req, null);
            }
        }
        // ⑤ 超时执行（虚拟线程 + 上下文显式传播：UserContext/Security/MDC 经 wrap，轮次 Turn 手动带过去）
        long start = System.currentTimeMillis();
        AiSessionHolder.Turn turn = sessionHolder.currentTurn();
        AiExecutionContext ctx = AiExecutionContext.capture(
                turn != null ? turn.requestId() : null, turn != null ? turn.traceId() : null);
        Map<String, Object> safeArgs = args == null ? Map.of() : args;
        Future<ToolResult> future = aiExecutor.submit(() -> {
            ToolResult[] holder = new ToolResult[1];
            Exception[] error = new Exception[1];
            ctx.wrap(() -> {
                if (turn != null) {
                    sessionHolder.set(turn.sessionId(), turn.messageId(), turn.requestId(), turn.traceId());
                }
                try {
                    holder[0] = registry.invoke(tool, new LinkedHashMap<>(safeArgs));
                } catch (Exception e) {
                    error[0] = e;
                } finally {
                    sessionHolder.clear();
                }
            }).run();
            if (error[0] != null) {
                throw error[0];
            }
            return holder[0];
        });
        try {
            ToolResult result = future.get(Math.max(def.timeoutSeconds(), 1), TimeUnit.SECONDS);
            long cost = System.currentTimeMillis() - start;
            // ⑥ 结果最小化
            String llmContent = result.llmContent();
            if (llmContent != null && llmContent.length() > MAX_LLM_CONTENT) {
                llmContent = llmContent.substring(0, MAX_LLM_CONTENT) + "…（结果超长已截断，完整数据见卡片）";
                result = ToolResult.of(llmContent, result.cards());
            }
            log.info("AI 工具调用 {} → {} cost={}ms", requestedName, canonical, cost);
            audit(toolCallId, canonical, risk, args, result.llmContent(),
                    AiToolCall.STATUS_SUCCEEDED, cost, null, user);
            return result;
        } catch (TimeoutException te) {
            future.cancel(true);
            long cost = System.currentTimeMillis() - start;
            audit(toolCallId, canonical, risk, args, null, AiToolCall.STATUS_FAILED, cost,
                    AiErrors.TOOL_TIMEOUT, user);
            return errorFrame(AiErrors.TOOL_TIMEOUT,
                    "工具执行超时（>" + def.timeoutSeconds() + "s），请稍后重试或缩小查询范围", null);
        } catch (Exception e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            if (cause.getCause() != null && cause instanceof java.lang.reflect.InvocationTargetException) {
                cause = cause.getCause();
            }
            long cost = System.currentTimeMillis() - start;
            log.info("AI 工具调用失败 {} cost={}ms err={}", canonical, cost, cause.getMessage());
            audit(toolCallId, canonical, risk, args, cause.getMessage(),
                    AiToolCall.STATUS_FAILED, cost, "EXECUTE_ERROR", user);
            return ToolResult.of("{\"error\":\""
                    + String.valueOf(cause.getMessage()).replace("\"", "'") + "\"}");
        }
    }

    // ==================== 内部 ====================

    private String firstMissingAuthority(UserContext user, AiToolDefinition def) {
        if (def.authorities().length == 0 || user.getPermissions() == null) {
            return null; // 无权限要求 / 离线 allow-all（与 hasPerm 口径一致）
        }
        for (String a : def.authorities()) {
            if (!user.getPermissions().contains(a)) {
                return a;
            }
        }
        return null;
    }

    private ToolResult errorFrame(String code, String message, Map<String, Object> extra) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", code + ": " + message);
        if (extra != null) {
            body.putAll(extra);
        }
        return ToolResult.of(toJson(body));
    }

    /** error 卡（§10 error partType）：亮点② 403 时带 missingAuthority/holderRoles/adminHint 申请引导。 */
    private Map<String, Object> errorCard(String code, String message, Map<String, Object> permissionExplain) {
        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "error");
        card.put("code", code);
        card.put("message", message);
        if (permissionExplain != null) {
            card.putAll(permissionExplain);
        }
        return card;
    }

    /** §14.4 审计落库（best-effort，risk 真实值）。 */
    private void audit(String toolCallId, String name, String risk, Map<String, Object> args,
                       String resultText, String status, long costMs, String errorCode, UserContext user) {
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
            row.setRiskLevel(risk);
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
        return s == null ? null : (s.length() > max ? s.substring(0, max) : s);
    }

    private String safeArgs(Map<String, Object> args) {
        try {
            String s = objectMapper.writeValueAsString(args == null ? Map.of() : args);
            return s.length() > 300 ? s.substring(0, 300) : s;
        } catch (Exception e) {
            return String.valueOf(args);
        }
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return String.valueOf(value);
        }
    }
}
