package com.xingchen.oa.workflow.orch.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.orch.entity.OrchExec;
import com.xingchen.oa.workflow.orch.entity.OrchFlow;
import com.xingchen.oa.workflow.orch.repository.OrchFlowRepository;
import com.xingchen.oa.workflow.orch.service.OrchExecService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 编排 Webhook 入站（触发器之四）：POST /api/orch/hooks/{token}（免登录，SecurityConfig permitAll）。
 * token 鉴权（匹配 enabled+已发布+triggerType=WEBHOOK 的编排）+ 基本限流（每 token 每分钟 60 次，
 * 超限 429）。body 即 payload，返回 {execId}。
 */
@RestController
@RequestMapping("/api/orch/hooks")
@RequiredArgsConstructor
public class OrchHookController {

    private static final int RATE_LIMIT_PER_MINUTE = 60;

    private final OrchFlowRepository flowRepository;
    private final OrchExecService execService;

    /** token → [分钟窗口, 计数]（单实例内存限流；集群需换分布式限流，与 CRON 调度同为集群扩展点）。 */
    private final Map<String, long[]> windows = new ConcurrentHashMap<>();
    private final AtomicInteger cleanupTick = new AtomicInteger();

    @PostMapping("/{token}")
    public R<Map<String, Object>> hook(@PathVariable String token,
                                       @RequestBody(required = false) Map<String, Object> payload) {
        OrchFlow flow = flowRepository.findByWebhookToken(token)
                .filter(f -> Boolean.TRUE.equals(f.getEnabled())
                        && f.getVersion() != null && f.getVersion() > 0
                        && OrchFlow.TRIGGER_WEBHOOK.equals(f.getTriggerType()))
                .orElseThrow(() -> new BusinessException(404, "无效的 webhook token"));
        rateLimit(token);
        Long execId = execService.trigger(flow, payload == null ? new LinkedHashMap<>() : payload,
                OrchExec.KIND_WEBHOOK, 0);
        return R.ok(Map.of("execId", execId));
    }

    private void rateLimit(String token) {
        long minute = System.currentTimeMillis() / 60_000;
        long[] w = windows.compute(token, (k, v) ->
                v == null || v[0] != minute ? new long[]{minute, 1} : new long[]{minute, v[1] + 1});
        if (w[1] > RATE_LIMIT_PER_MINUTE) {
            throw new BusinessException(429, "webhook 触发过于频繁（>" + RATE_LIMIT_PER_MINUTE + "/min）");
        }
        // 简单防膨胀：每 1000 次清一遍过期窗口
        if (cleanupTick.incrementAndGet() % 1000 == 0) {
            windows.entrySet().removeIf(e -> e.getValue()[0] != minute);
        }
    }
}
