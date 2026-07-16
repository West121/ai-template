package com.hentor.oa.workflow.engine;

import com.hentor.oa.workflow.entity.WfDelegateRule;
import com.hentor.oa.workflow.entity.WfInstanceExt;
import com.hentor.oa.workflow.entity.WfNotify;
import com.hentor.oa.workflow.entity.WfProcessExt;
import com.hentor.oa.workflow.repository.WfDelegateRuleRepository;
import com.hentor.oa.workflow.repository.WfInstanceExtRepository;
import com.hentor.oa.workflow.repository.WfNotifyRepository;
import com.hentor.oa.workflow.repository.WfProcessExtRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.engine.TaskService;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
import org.flowable.common.engine.api.delegate.event.FlowableEntityEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEventListener;
import org.flowable.common.engine.api.delegate.event.FlowableEventType;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEvent;
import org.flowable.engine.delegate.event.FlowableProcessStartedEvent;
import org.flowable.task.api.Task;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 引擎全局事件监听：
 * - PROCESS_STARTED：带 {@code __wfRegister=true} 流程变量的实例（业务模块直起引擎，如公文办文）
 *   自动注册 wf_instance_ext 行——公文实例成为一等 wf 实例（我发起/已办/监控/实例详情可见）。
 *   InstanceService 起单路径自己落行、不带该标记，互不重复。
 * - TASK_CREATED：向任务办理人投递 TODO 通知；
 * - PROCESS_COMPLETED / 终止结束：同步 wf_instance_ext.biz_status = APPROVED 并向发起人投递 RESULT 通知。
 * - PROCESS_CANCELLED：deleteProcessInstance（退回/撤销）时仍 RUNNING 的行同步 CANCELED（服务层随后可覆写更精确状态）。
 * 在 {@link FlowableEngineConfig} 中注册进 ProcessEngineConfiguration。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WfEngineEventListener implements FlowableEventListener {

    /** 业务模块直起引擎时的注册标记变量：__wfRegister=true → 本监听补 wf_instance_ext；__title=实例标题。 */
    public static final String VAR_REGISTER = "__wfRegister";
    public static final String VAR_TITLE = "__title";

    private final WfInstanceExtRepository instanceRepository;
    private final WfNotifyRepository notifyRepository;
    private final WfDelegateRuleRepository delegateRuleRepository;
    private final WfProcessExtRepository processRepository;
    /** 延迟解析，避免 processEngine ↔ 全局事件监听器循环依赖。 */
    private final ObjectProvider<TaskService> taskServiceProvider;

    @PersistenceContext
    private EntityManager entityManager;

    @Override
    public void onEvent(FlowableEvent event) {
        if (!(event.getType() instanceof FlowableEngineEventType type)) {
            return;
        }
        try {
            switch (type) {
                case PROCESS_STARTED -> onProcessStarted(event);
                case TASK_CREATED -> onTaskCreated(event);
                case PROCESS_COMPLETED, PROCESS_COMPLETED_WITH_TERMINATE_END_EVENT -> onProcessCompleted(event);
                case PROCESS_CANCELLED -> onProcessCancelled(event);
                default -> {
                }
            }
        } catch (Exception e) {
            log.warn("工作流事件处理异常 type={}: {}", type, e.getMessage());
        }
    }

    /**
     * 引擎级实例注册：业务模块直调 RuntimeService 起的实例（变量带 __wfRegister=true）
     * 自动补 wf_instance_ext 行，使其在 我发起/已办/流程监控/实例详情 与普通 wf 实例同等可见。
     */
    private void onProcessStarted(FlowableEvent event) {
        if (!(event instanceof FlowableProcessStartedEvent pse) || !(event instanceof FlowableEngineEvent ee)) {
            return;
        }
        Map<String, Object> vars = pse.getVariables();
        if (vars == null || !Boolean.TRUE.equals(vars.get(VAR_REGISTER))) {
            return;
        }
        String pid = ee.getProcessInstanceId();
        if (pid == null || instanceRepository.findByProcInstId(pid).isPresent()) {
            return;
        }
        String procDefId = ee.getProcessDefinitionId();
        String defKey = procDefId != null && procDefId.contains(":")
                ? procDefId.substring(0, procDefId.indexOf(':')) : procDefId;
        WfProcessExt def = defKey != null ? processRepository.findByDefCode(defKey).orElse(null) : null;

        WfInstanceExt inst = new WfInstanceExt();
        inst.setProcInstId(pid);
        inst.setDefCode(defKey != null ? defKey : "unknown");
        inst.setDefName(def != null ? def.getName() : defKey);
        Object title = vars.get(VAR_TITLE);
        inst.setTitle(title != null && !String.valueOf(title).isBlank()
                ? String.valueOf(title)
                : (def != null ? def.getName() : String.valueOf(defKey)));
        inst.setInitiatorId(asLong(vars.get("initiatorId")));
        Object initiatorName = vars.get("initiatorName");
        inst.setInitiatorName(initiatorName != null ? String.valueOf(initiatorName) : null);
        inst.setInitiatorDeptId(asLong(vars.get("initiatorDeptId")));
        inst.setFormCode(def != null ? def.getFormCode() : null);
        inst.setBizStatus(WfInstanceExt.STATUS_RUNNING);
        instanceRepository.save(inst);
        log.info("引擎级实例注册：{} ({}) pid={}", inst.getTitle(), inst.getDefCode(), pid);
    }

    /** deleteProcessInstance（退回/撤销等）：仍 RUNNING 的注册行同步 CANCELED（服务层后续覆写更精确状态不受影响）。 */
    private void onProcessCancelled(FlowableEvent event) {
        if (!(event instanceof FlowableEngineEvent ee)) {
            return;
        }
        String pid = ee.getProcessInstanceId();
        if (pid == null) {
            return;
        }
        bizdocSync(pid, "REJECTED"); // BizDoc §3：实例被删（驳回退发起人/终止/撤销）→ 单据 REJECTED 可改重提
        WfInstanceExt inst = instanceRepository.findByProcInstId(pid).orElse(null);
        if (inst == null || !WfInstanceExt.STATUS_RUNNING.equals(inst.getBizStatus())) {
            return;
        }
        inst.setBizStatus(WfInstanceExt.STATUS_CANCELED);
        inst.setEndedAt(OffsetDateTime.now());
        instanceRepository.save(inst);
    }

    /**
     * BizDoc 状态回写（§3 事件回写）：按 process_instance_id 原生 UPDATE oa_bizdoc（仅 APPROVING 态），
     * 不引入 office 实体依赖；非单据实例零行更新、零成本。失败不阻断引擎事件。
     */
    private void bizdocSync(String procInstId, String toStatus) {
        try {
            entityManager.createNativeQuery(
                            "UPDATE oa_bizdoc SET status = :st, updated_at = now() "
                                    + "WHERE process_instance_id = :pid AND status = 'APPROVING'")
                    .setParameter("st", toStatus)
                    .setParameter("pid", procInstId)
                    .executeUpdate();
        } catch (Exception e) {
            log.warn("BizDoc 状态回写失败 pid={} → {}: {}", procInstId, toStatus, e.getMessage());
        }
    }

    private Long asLong(Object v) {
        return v instanceof Number n ? n.longValue() : null;
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
        bizdocSync(procInstId, "EFFECTIVE"); // BizDoc §3：审批通过 → 单据生效（按 process_instance_id 原生回写）
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
        return List.of(FlowableEngineEventType.PROCESS_STARTED,
                FlowableEngineEventType.TASK_CREATED,
                FlowableEngineEventType.PROCESS_COMPLETED,
                FlowableEngineEventType.PROCESS_COMPLETED_WITH_TERMINATE_END_EVENT,
                FlowableEngineEventType.PROCESS_CANCELLED);
    }
}
