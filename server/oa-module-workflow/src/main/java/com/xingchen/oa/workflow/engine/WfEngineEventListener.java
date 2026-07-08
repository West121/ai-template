package com.xingchen.oa.workflow.engine;

import com.xingchen.oa.workflow.entity.WfDelegateRule;
import com.xingchen.oa.workflow.entity.WfInstanceExt;
import com.xingchen.oa.workflow.entity.WfNotify;
import com.xingchen.oa.workflow.repository.WfDelegateRuleRepository;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import com.xingchen.oa.workflow.repository.WfNotifyRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.engine.TaskService;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
import org.flowable.common.engine.api.delegate.event.FlowableEntityEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEventListener;
import org.flowable.common.engine.api.delegate.event.FlowableEventType;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEvent;
import org.flowable.task.api.Task;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Objects;

/**
 * 引擎全局事件监听：
 * - TASK_CREATED：向任务办理人投递 TODO 通知；
 * - PROCESS_COMPLETED / 终止结束：同步 wf_instance_ext.biz_status = APPROVED 并向发起人投递 RESULT 通知。
 * 在 {@link FlowableEngineConfig} 中注册进 ProcessEngineConfiguration。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WfEngineEventListener implements FlowableEventListener {

    private final WfInstanceExtRepository instanceRepository;
    private final WfNotifyRepository notifyRepository;
    private final WfDelegateRuleRepository delegateRuleRepository;
    /** 延迟解析，避免 processEngine ↔ 全局事件监听器循环依赖。 */
    private final ObjectProvider<TaskService> taskServiceProvider;

    @Override
    public void onEvent(FlowableEvent event) {
        if (!(event.getType() instanceof FlowableEngineEventType type)) {
            return;
        }
        try {
            switch (type) {
                case TASK_CREATED -> onTaskCreated(event);
                case PROCESS_COMPLETED, PROCESS_COMPLETED_WITH_TERMINATE_END_EVENT -> onProcessCompleted(event);
                default -> {
                }
            }
        } catch (Exception e) {
            log.warn("工作流事件处理异常 type={}: {}", type, e.getMessage());
        }
    }

    private void onTaskCreated(FlowableEvent event) {
        if (!(event instanceof FlowableEntityEvent ee) || !(ee.getEntity() instanceof Task task)) {
            return;
        }
        String assignee = task.getAssignee();
        if (assignee == null || assignee.isBlank()) {
            return;
        }
        Long uid = parseLong(assignee);
        if (uid == null) {
            return;
        }
        // 实例扩展行在 startProcessInstance 返回后才落库，这里不依赖它，标题回退到任务名
        String instTitle = instanceRepository.findByProcInstId(task.getProcessInstanceId())
                .map(WfInstanceExt::getTitle).orElse(safeName(task.getName()));
        notify(uid, WfNotify.TYPE_TODO, "待办：" + instTitle,
                "您有一条待办任务「" + safeName(task.getName()) + "」等待处理", task.getProcessInstanceId());
        applyAgentDelegate(task, uid);
    }

    /**
     * 代理预设：任务办理人若有生效中的委托规则（AGENT），给受托人挂 candidate，
     * 双方可见可办（任一办结即结束，历史双方可查）。失败不阻断任务创建。
     */
    private void applyAgentDelegate(Task task, Long ownerId) {
        try {
            String defKey = task.getProcessDefinitionId() != null
                    ? task.getProcessDefinitionId().split(":")[0] : null;
            LocalDate today = LocalDate.now();
            for (WfDelegateRule rule : delegateRuleRepository.findByOwnerIdAndEnabledTrue(ownerId)) {
                if (rule.getDefCode() != null && !Objects.equals(rule.getDefCode(), defKey)) {
                    continue;
                }
                if (rule.getStartDate() != null && today.isBefore(rule.getStartDate())) {
                    continue;
                }
                if (rule.getEndDate() != null && today.isAfter(rule.getEndDate())) {
                    continue;
                }
                if (Objects.equals(rule.getDelegateToId(), ownerId)) {
                    continue;
                }
                taskServiceProvider.getObject().addCandidateUser(task.getId(), String.valueOf(rule.getDelegateToId()));
                notify(rule.getDelegateToId(), WfNotify.TYPE_TODO, "代理待办：" + safeName(task.getName()),
                        "您被设为代理人，任务「" + safeName(task.getName()) + "」您与委托人均可办理",
                        task.getProcessInstanceId());
            }
        } catch (Exception e) {
            log.warn("代理规则挂 candidate 失败 task={}: {}", task.getId(), e.getMessage());
        }
    }

    private void onProcessCompleted(FlowableEvent event) {
        if (!(event instanceof FlowableEngineEvent ee)) {
            return;
        }
        String procInstId = ee.getProcessInstanceId();
        if (procInstId == null) {
            return;
        }
        WfInstanceExt inst = instanceRepository.findByProcInstId(procInstId).orElse(null);
        if (inst == null || !WfInstanceExt.STATUS_RUNNING.equals(inst.getBizStatus())) {
            return;
        }
        inst.setBizStatus(WfInstanceExt.STATUS_APPROVED);
        inst.setEndedAt(OffsetDateTime.now());
        instanceRepository.save(inst);
        if (inst.getInitiatorId() != null) {
            notify(inst.getInitiatorId(), WfNotify.TYPE_RESULT, "审批通过：" + inst.getTitle(),
                    "您发起的流程「" + inst.getTitle() + "」已审批通过", procInstId);
        }
    }

    private void notify(Long uid, String type, String title, String content, String procInstId) {
        WfNotify n = new WfNotify();
        n.setUserId(uid);
        n.setType(type);
        n.setTitle(title);
        n.setContent(content);
        n.setProcInstId(procInstId);
        n.setReadFlag(false);
        notifyRepository.save(n);
    }

    private String safeName(String s) {
        return s == null ? "" : s;
    }

    private Long parseLong(String s) {
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    @Override
    public boolean isFailOnException() {
        return false;
    }

    @Override
    public boolean isFireOnTransactionLifecycleEvent() {
        return false;
    }

    @Override
    public String getOnTransaction() {
        return null;
    }

    @Override
    public Collection<? extends FlowableEventType> getTypes() {
        return List.of(FlowableEngineEventType.TASK_CREATED,
                FlowableEngineEventType.PROCESS_COMPLETED,
                FlowableEngineEventType.PROCESS_COMPLETED_WITH_TERMINATE_END_EVENT);
    }
}
