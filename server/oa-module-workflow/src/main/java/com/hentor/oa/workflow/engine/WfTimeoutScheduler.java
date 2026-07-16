package com.hentor.oa.workflow.engine;

import com.hentor.oa.workflow.entity.WfInstanceExt;
import com.hentor.oa.workflow.entity.WfNotify;
import com.hentor.oa.workflow.entity.WfOperation;
import com.hentor.oa.workflow.repository.WfInstanceExtRepository;
import com.hentor.oa.workflow.support.WfAudit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;

/**
 * 超时/自动提醒扫描器：定期扫描带 oa:timeout 配置的活动任务，按 action 处理。
 * 说明：设计原案为「timer 边界事件 + AsyncExecutor」；此处采用等价的服务层扫描实现，
 * 便于携带业务语义（REMIND 按 remindEvery 重复、AUTO_PASS/AUTO_REJECT 走服务层收敛），
 * 且可用短周期(seconds)做确定性验证。timeout 配置：{hours|seconds, action, remindEvery(秒)}。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WfTimeoutScheduler {

    private static final String VAR_LAST_REMIND = "wfLastRemindAt";

    private final TaskService taskService;
    private final RuntimeService runtimeService;
    private final RepositoryService repositoryService;
    private final WfInstanceExtRepository instanceRepository;
    private final WfAudit audit;
    private final ObjectMapper objectMapper;

    @Scheduled(fixedDelayString = "${wf.timeout.scan-ms:3000}")
    @Transactional
    public void scan() {
        List<Task> tasks;
        try {
            tasks = taskService.createTaskQuery().active().list();
        } catch (Exception e) {
            return;
        }
        long now = Instant.now().toEpochMilli();
        for (Task t : tasks) {
            try {
                handle(t, now);
            } catch (Exception e) {
                log.warn("超时扫描处理任务 {} 异常: {}", t.getId(), e.getMessage());
            }
        }
    }

    private void handle(Task t, long now) {
        JsonNode cfg = timeoutConfig(t);
        if (cfg == null || t.getCreateTime() == null) {
            return;
        }
        long durationMs = cfg.has("seconds")
                ? cfg.path("seconds").asLong(0) * 1000L
                : cfg.path("hours").asLong(0) * 3600_000L;
        if (durationMs <= 0) {
            return;
        }
        long created = t.getCreateTime().getTime();
        long deadline = created + durationMs;
        String action = cfg.path("action").asString("REMIND").toUpperCase();

        if (now < deadline) {
            return;
        }
        switch (action) {
            case "AUTO_PASS" -> {
                audit.op(t.getProcessInstanceId(), t.getId(), t.getTaskDefinitionKey(), t.getName(), null,
                        WfOperation.ACTION_APPROVE, "超时自动通过");
                // 与 WfTaskService.approve 同源修复：complete() 在同事务内推进流程并对下一节点求值，
                // 若下一节点是 PREV_HANDLER/NODE_HANDLER，HistoryService 查询看不到刚完成的任务，
                // 故在 complete() 前把超时任务的办理人捕获到流程变量供其优先读取（assignee 为空的候选池任务则跳过，允许兜底）。
                captureHandlerVars(t.getProcessInstanceId(), t.getTaskDefinitionKey(), parseLong(t.getAssignee()));
                taskService.complete(t.getId());
            }
            case "AUTO_REJECT" -> {
                audit.op(t.getProcessInstanceId(), t.getId(), t.getTaskDefinitionKey(), t.getName(), null,
                        WfOperation.ACTION_REJECT, "超时自动驳回");
                autoReject(t.getProcessInstanceId());
            }
            default -> remind(t, cfg, now); // REMIND
        }
    }

    private void remind(Task t, JsonNode cfg, long now) {
        long everyMs = cfg.path("remindEvery").asLong(0) * 1000L;
        Long last = (Long) taskService.getVariable(t.getId(), VAR_LAST_REMIND);
        if (last != null && everyMs > 0 && now - last < everyMs) {
            return;
        }
        Long uid = parseLong(t.getAssignee());
        if (uid != null) {
            audit.notify(uid, WfNotify.TYPE_URGE, "超时提醒：" + t.getName(),
                    "任务「" + t.getName() + "」已超时，请尽快处理", t.getProcessInstanceId());
            audit.op(t.getProcessInstanceId(), t.getId(), t.getTaskDefinitionKey(), t.getName(), null,
                    WfOperation.ACTION_URGE, "超时自动提醒");
        }
        taskService.setVariable(t.getId(), VAR_LAST_REMIND, now);
    }

    private void autoReject(String pid) {
        runtimeService.deleteProcessInstance(pid, "超时自动驳回");
        instanceRepository.findByProcInstId(pid).ifPresent(inst -> {
            inst.setBizStatus(WfInstanceExt.STATUS_REJECTED);
            inst.setEndedAt(null);
            instanceRepository.save(inst);
        });
    }

    private JsonNode timeoutConfig(Task t) {
        try {
            FlowElement fe = repositoryService.getBpmnModel(t.getProcessDefinitionId())
                    .getMainProcess().getFlowElement(t.getTaskDefinitionKey(), true);
            if (fe == null || fe.getExtensionElements() == null) {
                return null;
            }
            List<ExtensionElement> list = fe.getExtensionElements().get("timeout");
            if (list == null || list.isEmpty()) {
                return null;
            }
            String text = list.get(0).getElementText();
            return (text == null || text.isBlank()) ? null : objectMapper.readTree(text);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 跨节点办理人求值修复（与 WfTaskService.captureHandlerVars 同逻辑）：在 complete() 推进流程前，
     * 把完成人写入根执行流程变量，供下一节点 PREV_HANDLER/NODE_HANDLER 优先读取。defKey/uid 为空则跳过。
     */
    private void captureHandlerVars(String pid, String defKey, Long uid) {
        if (defKey == null || uid == null) {
            return;
        }
        runtimeService.setVariable(pid, "__lastHandler", uid);
        runtimeService.setVariable(pid, "__handler_" + defKey, uid);
    }

    private Long parseLong(String s) {
        if (s == null || s.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
