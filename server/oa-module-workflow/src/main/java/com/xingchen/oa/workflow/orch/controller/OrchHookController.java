package com.xingchen.oa.workflow.orch.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.orch.entity.OrchFlow;
import com.xingchen.oa.workflow.orch.repository.OrchFlowRepository;
import com.xingchen.oa.workflow.orch.service.OrchExecService;
import com.xingchen.oa.workflow.orch.service.OrchExecService.WebhookRun;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 编排免登录入站端点（SecurityConfig permitAll）：
 * <ul>
 *   <li>POST /api/orch/hooks/{token}：Webhook 触发（token=enabled+已发布+WEBHOOK 流；限流 60/token/min）。
 *       流含 respond 节点时<b>同步等待</b>其执行（§9.4，syncTimeoutMs 默认 10s，超时/未达 respond 回退 202+execId），
 *       respond 之后的节点继续异步。</li>
 *   <li>POST /api/orch/resume/{token}：wait 挂起恢复（§9.2，resume_token 鉴权，body 存 wait.saveAs）。</li>
 * </ul>
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class OrchHookController {

    private static final int RATE_LIMIT_PER_MINUTE = 60;

    private final OrchFlowRepository flowRepository;
    private final OrchExecService execService;
    private final ObjectMapper objectMapper;

    /** key → [分钟窗口, 计数]（单实例内存限流；集群扩展点同 CRON 调度）。 */
    private final Map<String, long[]> windows = new ConcurrentHashMap<>();
    private final AtomicInteger cleanupTick = new AtomicInteger();

    @PostMapping("/api/orch/hooks/{token}")
    public ResponseEntity<?> hook(@PathVariable String token,
                                  @RequestBody(required = false) Map<String, Object> payload) {
        OrchFlow flow = flowRepository.findByWebhookToken(token)
                .filter(f -> Boolean.TRUE.equals(f.getEnabled())
                        && f.getVersion() != null && f.getVersion() > 0
                        && OrchFlow.TRIGGER_WEBHOOK.equals(f.getTriggerType()))
                .orElseThrow(() -> new BusinessException(404, "无效的 webhook token"));
        rateLimit(token);
        WebhookRun run = execService.runWebhook(flow, payload == null ? new LinkedHashMap<>() : payload);
        if (run.respondFuture() == null) {
            // 无 respond 节点：维持异步语义（200 + execId）
            return ResponseEntity.ok(R.ok(Map.of("execId", run.execId())));
        }
        try {
            Map<String, Object> resp = run.respondFuture().get(run.syncTimeoutMs(), TimeUnit.MILLISECONDS);
            if (resp == null) {
                // 执行结束但未经过 respond（条件绕过/失败）→ 回退 202
                return accepted(run.execId());
            }
            int status = resp.get("status") instanceof Number n ? n.intValue() : 200;
            String contentType = String.valueOf(resp.getOrDefault("contentType", "application/json"));
            Object body = resp.get("body");
            String bodyStr = body == null ? ""
                    : (body instanceof String s ? s : objectMapper.writeValueAsString(body));
            return ResponseEntity.status(status)
                    .contentType(MediaType.parseMediaType(contentType))
                    .body(bodyStr);
        } catch (Exception e) {
            // 同步窗口超时 → 202 + execId，执行继续异步
            return accepted(run.execId());
        }
    }

    /** §9.2 wait 恢复：body 存入 wait 节点 saveAs，续执行后继段。 */
    @PostMapping("/api/orch/resume/{token}")
    public R<Map<String, Object>> resume(@PathVariable String token,
                                         @RequestBody(required = false) Map<String, Object> body) {
        rateLimit("resume:" + token);
        Long execId = execService.resumeByToken(token, body == null ? new LinkedHashMap<>() : body);
        return R.ok(Map.of("execId", execId));
    }

    private ResponseEntity<R<Map<String, Object>>> accepted(Long execId) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(R.ok(Map.of("execId", execId)));
    }

    private void rateLimit(String key) {
        long minute = System.currentTimeMillis() / 60_000;
        long[] w = windows.compute(key, (k, v) ->
                v == null || v[0] != minute ? new long[]{minute, 1} : new long[]{minute, v[1] + 1});
        if (w[1] > RATE_LIMIT_PER_MINUTE) {
            throw new BusinessException(429, "触发过于频繁（>" + RATE_LIMIT_PER_MINUTE + "/min）");
        }
        if (cleanupTick.incrementAndGet() % 1000 == 0) {
            windows.entrySet().removeIf(e -> e.getValue()[0] != minute);
        }
    }
}
