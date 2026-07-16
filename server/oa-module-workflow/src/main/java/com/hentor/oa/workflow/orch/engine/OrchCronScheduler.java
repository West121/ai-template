package com.hentor.oa.workflow.orch.engine;

import com.hentor.oa.workflow.orch.entity.OrchExec;
import com.hentor.oa.workflow.orch.entity.OrchFlow;
import com.hentor.oa.workflow.orch.repository.OrchFlowRepository;
import com.hentor.oa.workflow.orch.service.OrchExecService;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

/**
 * 编排 CRON 调度器（触发器之二）：Spring TaskScheduler 动态注册。
 * 只调度 enabled + 已发布(version>0) + triggerType=CRON 的编排；启停/发布/更新/删除经
 * {@link #refresh}/{@link #remove} 刷新注册；启动全量注册。表达式为 Spring 6 段 cron。
 *
 * <p><b>集群扩展点</b>：当前为单实例内存调度（本项目单体部署）。多实例部署需防重复触发——
 * 替换 {@link #schedule} 为分布式调度（xxl-job 执行器注册 / ShedLock 包裹任务 / 数据库抢锁），
 * 其余（refresh 时机、执行入口 trigger()）不变。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OrchCronScheduler {

    private final OrchFlowRepository flowRepository;
    private final OrchExecService execService;
    private final ObjectMapper objectMapper;

    private final Map<Long, ScheduledFuture<?>> tasks = new ConcurrentHashMap<>();
    private volatile ThreadPoolTaskScheduler scheduler;

    @EventListener(ApplicationReadyEvent.class)
    public void init() {
        ThreadPoolTaskScheduler ts = new ThreadPoolTaskScheduler();
        ts.setPoolSize(2);
        ts.setThreadNamePrefix("orch-cron-");
        ts.setDaemon(true);
        ts.initialize();
        scheduler = ts;
        int n = 0;
        for (OrchFlow flow : flowRepository.findByEnabledTrueAndTriggerType(OrchFlow.TRIGGER_CRON)) {
            if (schedule(flow)) {
                n++;
            }
        }
        if (n > 0) {
            log.info("编排 CRON 调度：启动注册 {} 条", n);
        }
    }

    @PreDestroy
    public void shutdown() {
        tasks.values().forEach(f -> f.cancel(false));
        tasks.clear();
        if (scheduler != null) {
            scheduler.shutdown();
        }
    }

    /** 发布/启停/更新后刷新：先撤旧注册，符合条件（CRON+enabled+已发布）再重挂。 */
    public synchronized void refresh(OrchFlow flow) {
        remove(flow.getId());
        if (Boolean.TRUE.equals(flow.getEnabled())
                && flow.getVersion() != null && flow.getVersion() > 0
                && OrchFlow.TRIGGER_CRON.equals(flow.getTriggerType())) {
            schedule(flow);
        }
    }

    public void remove(Long flowId) {
        ScheduledFuture<?> f = tasks.remove(flowId);
        if (f != null) {
            f.cancel(false);
        }
    }

    private boolean schedule(OrchFlow flow) {
        if (scheduler == null) {
            return false;
        }
        String cron = cronOf(flow);
        if (!StringUtils.hasText(cron)) {
            log.warn("编排 {} triggerType=CRON 但缺 cron 表达式，跳过调度", flow.getCode());
            return false;
        }
        Long flowId = flow.getId();
        try {
            ScheduledFuture<?> future = scheduler.schedule(() -> {
                try {
                    OrchFlow latest = flowRepository.findById(flowId).orElse(null);
                    if (latest != null) {
                        execService.trigger(latest, new LinkedHashMap<>(), OrchExec.KIND_CRON, 0);
                    }
                } catch (Exception e) {
                    log.warn("编排 CRON 触发失败 flow={}: {}", flowId, e.getMessage());
                }
            }, new CronTrigger(cron));
            tasks.put(flowId, future);
            log.info("编排 CRON 调度：{} ({}) 已注册 [{}]", flow.getName(), flow.getCode(), cron);
            return true;
        } catch (Exception e) {
            log.warn("编排 CRON 注册失败 {} [{}]: {}", flow.getCode(), cron, e.getMessage());
            return false;
        }
    }

    private String cronOf(OrchFlow flow) {
        if (!StringUtils.hasText(flow.getTriggerConfig())) {
            return null;
        }
        try {
            return objectMapper.readTree(flow.getTriggerConfig()).path("cron").asString(null);
        } catch (Exception e) {
            return null;
        }
    }
}
