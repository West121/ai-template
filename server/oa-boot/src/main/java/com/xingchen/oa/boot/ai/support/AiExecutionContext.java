package com.xingchen.oa.boot.ai.support;

import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import org.slf4j.MDC;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.HashMap;
import java.util.Map;

/**
 * AI 执行上下文快照与显式传播（ai-assistant-design-v2.md §5.2 + 附2 第 2 条，批A 第一验收项）：
 * SSE 为异步执行，V1「同步线程天然安全」前提失效——请求线程 {@link #capture} 快照
 * UserContext/SecurityContext/MDC/requestId/traceId，工作线程经 {@link #wrap} 装饰器显式装入并在
 * finally 清理。业务 Service 不依赖"碰巧还在同一线程"的 ThreadLocal；工具入口断言上下文存在，缺失即拒。
 */
public record AiExecutionContext(
        UserContext user,
        Authentication authentication,
        String requestId,
        String traceId,
        Map<String, String> mdc) {

    /** 请求线程内快照当前上下文（必须在返回 SseEmitter / 提交异步任务前调用）。 */
    public static AiExecutionContext capture(String requestId, String traceId) {
        Map<String, String> mdcCopy = MDC.getCopyOfContextMap();
        return new AiExecutionContext(
                CurrentUserHolder.get(),
                SecurityContextHolder.getContext().getAuthentication(),
                requestId, traceId,
                mdcCopy == null ? Map.of() : mdcCopy);
    }

    /** 装饰任务：工作线程装入快照上下文 → 执行 → finally 全量清理（虚拟线程一次性，防串染）。 */
    public Runnable wrap(Runnable task) {
        return () -> {
            CurrentUserHolder.set(user);
            SecurityContext sc = SecurityContextHolder.createEmptyContext();
            sc.setAuthentication(authentication);
            SecurityContextHolder.setContext(sc);
            MDC.setContextMap(new HashMap<>(mdc));
            if (requestId != null) {
                MDC.put("requestId", requestId);
            }
            if (traceId != null) {
                MDC.put("traceId", traceId);
            }
            try {
                task.run();
            } finally {
                CurrentUserHolder.clear();
                SecurityContextHolder.clearContext();
                MDC.clear();
            }
        };
    }
}
