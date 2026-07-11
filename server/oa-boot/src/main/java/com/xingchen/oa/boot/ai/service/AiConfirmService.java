package com.xingchen.oa.boot.ai.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * 写操作确认二段式（安全红线 §0.2）：变更工具只产 confirm 卡（动作暂存），用户点确认 →
 * POST /api/ai/confirm 才真正执行。暂存内存 10min 过期、绑定 user+session；
 * 执行在确认请求线程内（UserContext=确认者）→ 底层 Service 的权限/归属校验二次生效。
 */
@Slf4j
@Service
public class AiConfirmService {

    private static final long TTL_MS = 10 * 60_000L;

    /** 待确认动作。 */
    public record Pending(String actionId, Long userId, Long sessionId, String toolName,
                          Map<String, Object> params, String summary, boolean danger, long expireAt) {
    }

    private final Map<String, Pending> pending = new ConcurrentHashMap<>();
    /** toolName → 确认执行器（ChangeTools @PostConstruct 注册），返回执行结果（入 confirm 响应 data）。 */
    private final Map<String, Function<Map<String, Object>, Object>> executors = new ConcurrentHashMap<>();

    public void registerExecutor(String toolName, Function<Map<String, Object>, Object> executor) {
        executors.put(toolName, executor);
    }

    /** 暂存动作，返回 actionId（confirm 卡用）。 */
    public String stage(Long sessionId, String toolName, Map<String, Object> params,
                        String summary, boolean danger) {
        purgeExpired();
        UserContext ctx = CurrentUserHolder.get();
        String actionId = UUID.randomUUID().toString().replace("-", "");
        pending.put(actionId, new Pending(actionId, ctx != null ? ctx.getUserId() : null,
                sessionId, toolName, params, summary, danger, System.currentTimeMillis() + TTL_MS));
        return actionId;
    }

    /**
     * 确认执行：校验 actionId 存在未过期 + user 绑定 → 调注册的执行器（底层 Service 权限二验）。
     * 不存在/过期 → 410；他人动作 → 403。一次性：执行前即移除（成败都不复用）。
     */
    public Map<String, Object> confirm(String actionId) {
        purgeExpired();
        Pending p = pending.get(actionId);
        if (p == null || p.expireAt() < System.currentTimeMillis()) {
            pending.remove(actionId);
            throw new BusinessException(410, "确认操作不存在或已过期，请重新发起");
        }
        UserContext ctx = CurrentUserHolder.get();
        if (ctx == null || !ctx.getUserId().equals(p.userId())) {
            throw new BusinessException(403, "该确认操作不属于当前用户");
        }
        pending.remove(actionId);
        Function<Map<String, Object>, Object> executor = executors.get(p.toolName());
        if (executor == null) {
            throw new BusinessException(400, "该操作类型不支持确认执行: " + p.toolName());
        }
        Object data = executor.apply(p.params()); // 请求线程内执行，UserContext/权限二验天然生效
        log.info("AI confirm 执行 {} tool={} user={}", actionId, p.toolName(), ctx.getUserId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("success", true);
        out.put("message", p.summary() + " 已执行");
        out.put("data", data);
        return out;
    }

    private void purgeExpired() {
        long now = System.currentTimeMillis();
        pending.entrySet().removeIf(e -> e.getValue().expireAt() < now);
    }
}
