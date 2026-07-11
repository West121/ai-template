package com.xingchen.oa.boot.ai.orchestration;

import com.xingchen.oa.boot.ai.support.AiErrors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 配额（§18，批B 内存实现留扩展点）：每用户每分钟模型请求数（固定窗口）。
 * 扩展点：抽换为 Redis/DB 计量（每日 Token/月度预算等在批B 之后按 §18.2 逐项补），
 * 本实现单实例内存计数——与会话串行锁同口径（单体部署）。
 */
@Service
public class AiQuotaService {

    /** 每用户每分钟模型请求上限；0=不限流。 */
    @Value("${ai-assistant.quota.rpm:120}")
    private int rpm;

    private record Window(long minute, AtomicInteger count) {
    }

    private final Map<Long, Window> windows = new ConcurrentHashMap<>();

    /** 记一次模型请求；超限抛 429 AI_QUOTA_EXCEEDED。 */
    public void checkAndRecord(Long userId) {
        if (rpm <= 0 || userId == null) {
            return;
        }
        long minute = System.currentTimeMillis() / 60_000L;
        Window w = windows.compute(userId, (k, old) ->
                old == null || old.minute() != minute ? new Window(minute, new AtomicInteger()) : old);
        if (w.count().incrementAndGet() > rpm) {
            throw AiErrors.e(429, AiErrors.QUOTA_EXCEEDED,
                    "AI 请求过于频繁（>" + rpm + "次/分钟），请稍后再试");
        }
    }
}
