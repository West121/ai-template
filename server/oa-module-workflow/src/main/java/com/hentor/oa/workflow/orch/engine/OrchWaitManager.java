package com.hentor.oa.workflow.orch.engine;

import com.hentor.oa.workflow.orch.entity.OrchExec;
import com.hentor.oa.workflow.orch.repository.OrchExecRepository;
import com.hentor.oa.workflow.orch.service.OrchExecService;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * wait 挂起超时管理（§9.2）：内存定时器 + 启动恢复扫描。
 * 挂起时 schedule(execId, deadline)；resume 时 cancel；到点回调 execService.waitTimeout（幂等，状态自检）。
 * 启动扫描 WAITING 流水：deadline 已过立即超时，未过按剩余时间重挂（应用重启不丢超时）。
 * 单实例内存实现（集群扩展点同 CRON 调度：换分布式定时/DB 扫描）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OrchWaitManager {

    private final OrchExecRepository execRepository;
    private final ObjectMapper objectMapper;
    /** 懒注入：ExecService 挂起时反向调用本组件。 */
    private final ObjectProvider<OrchExecService> execServiceProvider;

    private final Map<Long, ScheduledFuture<?>> timers = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1, r -> {
        Thread t = new Thread(r, "orch-wait-timer");
        t.setDaemon(true);
        return t;
    });

    @PreDestroy
    public void shutdown() {
        scheduler.shutdownNow();
    }

    public void schedule(Long execId, long deadlineEpochMs) {
        cancel(execId);
        long delay = Math.max(0, deadlineEpochMs - System.currentTimeMillis());
        timers.put(execId, scheduler.schedule(() -> {
            timers.remove(execId);
            try {
                execServiceProvider.getObject().waitTimeout(execId);
            } catch (Exception e) {
                log.warn("wait 超时处理失败 exec={}: {}", execId, e.getMessage());
            }
        }, delay, TimeUnit.MILLISECONDS));
    }

    public void cancel(Long execId) {
        ScheduledFuture<?> f = timers.remove(execId);
        if (f != null) {
            f.cancel(false);
        }
    }

    /** 启动恢复扫描：重挂全部 WAITING 流水的超时定时器。 */
    @EventListener(ApplicationReadyEvent.class)
    public void recover() {
        int n = 0;
        try {
            for (OrchExec exec : execRepository.findByStatus(OrchExec.STATUS_WAITING)) {
                long deadline = System.currentTimeMillis() + 60_000; // 快照缺失兜底：1min 后超时
                try {
                    deadline = objectMapper.readTree(exec.getContextSnapshot() == null ? "{}" : exec.getContextSnapshot())
                            .path("waitDeadline").asLong(deadline);
                } catch (Exception ignored) {
                    // 用兜底 deadline
                }
                schedule(exec.getId(), deadline);
                n++;
            }
        } catch (Exception e) {
            log.warn("wait 挂起恢复扫描失败: {}", e.getMessage());
        }
        if (n > 0) {
            log.info("编排 wait 恢复扫描：重挂 {} 条 WAITING 超时定时器", n);
        }
    }
}
