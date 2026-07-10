package com.xingchen.oa.workflow.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.workflow.dto.OrgRef;
import com.xingchen.oa.workflow.dto.P2Requests.AddSignRequest;
import com.xingchen.oa.workflow.dto.P2Requests.AssigneeRequest;
import com.xingchen.oa.workflow.dto.P2Requests.CounterSignRequest;
import com.xingchen.oa.workflow.dto.P2Requests.ReduceSignRequest;
import com.xingchen.oa.workflow.dto.P2Requests.RetrieveRequest;
import com.xingchen.oa.workflow.dto.RejectRequest;
import com.xingchen.oa.workflow.dto.TaskActionRequest;
import com.xingchen.oa.workflow.dto.TaskItem;
import com.xingchen.oa.workflow.engine.AssigneeResolver;
import com.xingchen.oa.workflow.engine.WfVoteService;
import com.xingchen.oa.workflow.entity.WfInstanceExt;
import com.xingchen.oa.workflow.entity.WfOperation;
import com.xingchen.oa.workflow.entity.WfProcessExt;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import com.xingchen.oa.workflow.repository.WfProcessExtRepository;
import com.xingchen.oa.workflow.support.WfAudit;
import com.xingchen.oa.workflow.support.WfSupport;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.runtime.Execution;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.task.api.DelegationState;
import org.flowable.task.api.Task;
import org.flowable.task.api.history.HistoricTaskInstance;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 任务运行时：待办/已办/审批/驳回 + P2 中国式操作（加签/减签/转办/委派/拿回）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WfTaskService {

    private final TaskService taskService;
    private final RuntimeService runtimeService;
    private final HistoryService historyService;
    private final RepositoryService repositoryService;
    private final WfInstanceExtRepository instanceRepository;
    private final WfProcessExtRepository processRepository;
    private final AssigneeResolver assigneeResolver;
    private final WfVoteService voteService;
    private final AddSignService addSignService;
    private final WfAudit audit;
    private final ObjectMapper objectMapper;

    /* ---------------- 待办 ---------------- */

    public PageResult<TaskItem> todo(int pageNum, int pageSize) {
        String uid = String.valueOf(WfSupport.currentUser().getUserId());
        // taskInvolvedUser 覆盖候选/代理 identityLink（assignee=委托人时受托人 candidate 也可见）；
        // 但会带出 owner=我 的转办/委派出去的任务，需过滤：仅当我是 assignee 或我不是 owner 时保留。
        List<Task> raw = taskService.createTaskQuery().active()
                .or().taskAssignee(uid).taskInvolvedUser(uid).endOr()
                .orderByTaskCreateTime().desc().list();
        java.util.LinkedHashMap<String, Task> distinct = new java.util.LinkedHashMap<>();
        for (Task t : raw) {
            if (uid.equals(t.getAssignee()) || !uid.equals(t.getOwner())) {
                distinct.putIfAbsent(t.getId(), t);
            }
        }
        List<Task> filtered = new java.util.ArrayList<>(distinct.values());
        long total = filtered.size();
        int from = Math.min(Math.max(pageNum - 1, 0) * pageSize, filtered.size());
        int to = Math.min(from + pageSize, filtered.size());
        List<TaskItem> list = filtered.subList(from, to).stream().map(this::toItem).toList();
        return new PageResult<>(list, total, pageNum, pageSize);
    }

    /* ---------------- 已办 ---------------- */

    public PageResult<TaskItem> done(int pageNum, int pageSize) {
        String uid = String.valueOf(WfSupport.currentUser().getUserId());
        long total = historyService.createHistoricTaskInstanceQuery().taskAssignee(uid).finished().count();
        List<HistoricTaskInstance> tasks = historyService.createHistoricTaskInstanceQuery()
                .taskAssignee(uid).finished()
                .orderByHistoricTaskInstanceEndTime().desc()
                .listPage(Math.max(pageNum - 1, 0) * pageSize, pageSize);
        List<TaskItem> list = tasks.stream().map(t -> {
            WfInstanceExt inst = instanceRepository.findByProcInstId(t.getProcessInstanceId()).orElse(null);
            return new TaskItem(t.getId(), t.getProcessInstanceId(),
                    inst != null ? inst.getTitle() : null,
                    inst != null ? inst.getDefName() : null,
                    t.getName(),
                    inst != null ? inst.getInitiatorName() : null,
                    inst != null ? inst.getCreatedAt() : null, false, false);
        }).toList();
        return new PageResult<>(list, total, pageNum, pageSize);
    }

    private TaskItem toItem(Task t) {
        WfInstanceExt inst = instanceRepository.findByProcInstId(t.getProcessInstanceId()).orElse(null);
        boolean claim = t.getAssignee() == null;
        boolean delegated = t.getDelegationState() == DelegationState.PENDING;
        String title = inst != null ? inst.getTitle() : null;
        String defName = inst != null ? inst.getDefName() : null;
        String initiatorName = inst != null ? inst.getInitiatorName() : null;
        OffsetDateTime createdAt = inst != null ? inst.getCreatedAt() : null;
        if (inst == null) {
            // 无 wf_instance_ext 托管的实例（如公文办文经 RuntimeService 起）——从共享 Flowable 引擎回退取
            // 流程名/标题(实例名)/发起人/起始时间。只读本引擎数据，workflow 不反向依赖起单方(office)。
            FlowableMeta m = flowableMeta(t.getProcessInstanceId());
            title = m.title();
            defName = m.defName();
            initiatorName = m.initiatorName();
            createdAt = m.createdAt();
        }
        return new TaskItem(t.getId(), t.getProcessInstanceId(),
                title, defName, t.getName(), initiatorName, createdAt, claim, delegated);
    }

    /** 从 Flowable 运行时实例回退取元数据（实例名=标题、流程定义名、initiatorName 变量、起始时间）。 */
    private FlowableMeta flowableMeta(String procInstId) {
        try {
            ProcessInstance pi = runtimeService.createProcessInstanceQuery()
                    .processInstanceId(procInstId).singleResult();
            if (pi == null) {
                return new FlowableMeta(null, null, null, null);
            }
            Object initiatorName = runtimeService.getVariable(procInstId, "initiatorName");
            OffsetDateTime createdAt = pi.getStartTime() == null ? null
                    : pi.getStartTime().toInstant().atZone(ZoneId.systemDefault()).toOffsetDateTime();
            return new FlowableMeta(
                    StringUtils.hasText(pi.getName()) ? pi.getName() : null,
                    pi.getProcessDefinitionName(),
                    initiatorName != null ? String.valueOf(initiatorName) : null,
                    createdAt);
        } catch (Exception e) {
            return new FlowableMeta(null, null, null, null);
        }
    }

    private record FlowableMeta(String title, String defName, String initiatorName, OffsetDateTime createdAt) {
    }

    /* ---------------- 审批通过（委派感知） ---------------- */

    @Transactional
    public void approve(String taskId, TaskActionRequest req) {
        UserContext ctx = WfSupport.currentUser();
        Task task = requireMyTask(taskId, ctx);
        requireAllowedOp(task, "approve");
        String pid = task.getProcessInstanceId();

        String comment = req != null ? req.comment() : null;
        // P2：审批意见必填校验（节点 commentRequired）
        if (!StringUtils.hasText(comment) && commentRequired(task)) {
            throw new BusinessException(400, "该节点要求填写审批意见");
        }

        Map<String, Object> vars = new LinkedHashMap<>();
        if (req != null && req.formData() != null) {
            putScalarVars(vars, req.formData());
            updateInstanceForm(pid, req.formData());
        }
        if (StringUtils.hasText(comment)) {
            taskService.addComment(taskId, pid, comment);
        }

        // 委派受托人审批 = resolveTask 回原委派人
        if (task.getDelegationState() == DelegationState.PENDING) {
            if (!vars.isEmpty()) {
                taskService.setVariablesLocal(taskId, vars);
            }
            audit.op(pid, taskId, task.getTaskDefinitionKey(), task.getName(), ctx,
                    WfOperation.ACTION_RESOLVE, comment);
            taskService.resolveTask(taskId);
            if (task.getOwner() != null) {
                audit.notify(parseLong(task.getOwner()), com.xingchen.oa.workflow.entity.WfNotify.TYPE_TODO,
                        "委派已办理", "您委派的任务「" + task.getName() + "」已由受托人办理，请确认提交", pid);
            }
            return;
        }

        audit.op(pid, taskId, task.getTaskDefinitionKey(), task.getName(), ctx,
                WfOperation.ACTION_APPROVE, comment, attachDetail(req));
        // 加签串行链：非末位则把任务流转到链中下一人，不推进节点
        if (addSignService.advance(task, ctx, vars)) {
            return;
        }
        // 票签节点：记赞成票（供 completionCondition ${wfVote.pass(execution)} 求值）
        if (voteService.isVoteNode(task)) {
            voteService.recordApprove(task, ctx.getUserId());
        }
        String completedNode = task.getTaskDefinitionKey();
        captureHandlerVars(pid, completedNode, ctx.getUserId());
        if (vars.isEmpty()) {
            taskService.complete(taskId);
        } else {
            taskService.complete(taskId, vars);
        }
        applyResumeStrategy(pid, completedNode);
    }

    /**
     * 跨节点办理人求值修复：在 {@code complete()} 推进流程之前，把完成人写入流程变量
     * （同事务内 execution.getVariable 对根执行可见，而 HistoryService 查询在同事务内看不到刚完成的任务），
     * 供下一节点 PREV_HANDLER/NODE_HANDLER 求值时优先读取，避免误落 emptyStrategy=TO_ADMIN 兜底。
     * 注：{@code __lastHandler}/{@code __handler_<node>} 是保留流程变量名（{@code __} 前缀约定），
     * 表单字段/流程变量不得复用这些名字。并行网关分支/多实例会签场景下 {@code __lastHandler} 为
     * 「最后写入者胜」（最后提交的那个分支/办理人），与修复前 HistoryService 的 orderByEndTime desc 取最近一个语义一致——属预期行为，非 bug。
     */
    private void captureHandlerVars(String pid, String defKey, Long uid) {
        if (defKey == null || uid == null) {
            return;
        }
        runtimeService.setVariable(pid, "__lastHandler", uid);
        runtimeService.setVariable(pid, "__handler_" + defKey, uid);
    }

    /**
     * 驳回重审策略 CONTINUE：被驳节点重审完成后，若登记了 __resumeMap[node]=驳回点，
     * 则把当前活动跳回驳回点续走（best-effort，失败不阻断）。
     */
    @SuppressWarnings("unchecked")
    private void applyResumeStrategy(String pid, String completedNode) {
        try {
            if (runtimeService.createProcessInstanceQuery().processInstanceId(pid).count() == 0) {
                return;
            }
            Map<String, Object> resumeMap = (Map<String, Object>) runtimeService.getVariable(pid, "__resumeMap");
            if (resumeMap == null || !resumeMap.containsKey(completedNode)) {
                return;
            }
            // 该被驳节点仍有活动任务则等待其全部完成
            long active = taskService.createTaskQuery().processInstanceId(pid)
                    .taskDefinitionKey(completedNode).active().count();
            if (active > 0) {
                return;
            }
            String resumeTo = String.valueOf(resumeMap.remove(completedNode));
            runtimeService.setVariable(pid, "__resumeMap", resumeMap);
            moveTo(pid, resumeTo);
        } catch (Exception e) {
            log.warn("重审策略 CONTINUE 跳回失败 pid={} node={}: {}", pid, completedNode, e.getMessage());
        }
    }

    /* ---------------- 驳回（PREV / START / NODE + 重审策略） ---------------- */

    @Transactional
    public void reject(String taskId, RejectRequest req) {
        UserContext ctx = WfSupport.currentUser();
        Task task = requireMyTask(taskId, ctx);
        requireAllowedOp(task, "reject");
        String pid = task.getProcessInstanceId();
        String comment = req != null ? req.comment() : null;
        String target = req != null && StringUtils.hasText(req.target()) ? req.target() : "START";
        String currentNode = task.getTaskDefinitionKey();

        if (StringUtils.hasText(comment)) {
            taskService.addComment(taskId, pid, comment);
        }
        audit.op(pid, taskId, currentNode, task.getName(), ctx, WfOperation.ACTION_REJECT, comment);

        WfInstanceExt inst = instanceRepository.findByProcInstId(pid)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));

        if ("START".equalsIgnoreCase(target)) {
            returnToInitiator(pid, inst);
            return;
        }

        String targetNode;
        if ("NODE".equalsIgnoreCase(target)) {
            targetNode = req.targetNodeId();
            if (!StringUtils.hasText(targetNode)) {
                throw new BusinessException(400, "驳回到指定节点需提供 targetNodeId");
            }
        } else { // PREV
            targetNode = previousUserTaskNode(pid, currentNode);
            if (targetNode == null) {
                returnToInitiator(pid, inst);
                return;
            }
        }

        // 重审策略：CONTINUE=目标节点重审后回驳回点续走；BACK=重走中间路径（默认）
        boolean continueStrategy = req != null && "CONTINUE".equalsIgnoreCase(req.resumeStrategy());
        try {
            moveTo(pid, targetNode);
        } catch (Exception e) {
            throw new BusinessException(400, "驳回到节点失败（多实例收敛限制）：" + e.getMessage());
        }
        if (continueStrategy) {
            @SuppressWarnings("unchecked")
            Map<String, Object> resumeMap = (Map<String, Object>) runtimeService.getVariable(pid, "__resumeMap");
            if (resumeMap == null) {
                resumeMap = new LinkedHashMap<>();
            }
            resumeMap.put(targetNode, currentNode);
            runtimeService.setVariable(pid, "__resumeMap", resumeMap);
        }
    }

    /** 退回发起人：删除运行实例并置为可重提状态。 */
    private void returnToInitiator(String pid, WfInstanceExt inst) {
        runtimeService.deleteProcessInstance(pid, "退回发起人");
        inst.setBizStatus(WfInstanceExt.STATUS_REJECTED);
        inst.setEndedAt(null);
        instanceRepository.save(inst);
    }

    /* ---------------- 加签（PRE / POST） ---------------- */

    @Transactional
    public void addSign(String taskId, AddSignRequest req) {
        UserContext ctx = WfSupport.currentUser();
        Task task = requireMyTask(taskId, ctx);
        requireAllowedOp(task, "addSign");
        List<Long> users = resolveUsers(req.users()); // 严格校验用户存在
        if (StringUtils.hasText(req.comment())) {
            taskService.addComment(taskId, task.getProcessInstanceId(), req.comment());
        }
        // 串行加签链：PRE=被加签人先审再回我；POST=我先审再被加签人审（见 AddSignService）
        addSignService.create(task, ctx, req.mode(), users, req.comment());
    }

    /* ---------------- 并签 ---------------- */

    @Transactional
    public void counterSign(String taskId, CounterSignRequest req) {
        UserContext ctx = WfSupport.currentUser();
        Task task = requireMyTask(taskId, ctx);
        requireAllowedOp(task, "counterSign");
        List<Long> users = resolveUsers(req.users());
        if (users.isEmpty()) {
            throw new BusinessException(400, "并签人不能为空");
        }
        String parentExec = miRootExecutionId(task);
        for (Long uid : users) {
            runtimeService.addMultiInstanceExecution(task.getTaskDefinitionKey(), parentExec,
                    Map.of("assignee", String.valueOf(uid)));
        }
        audit.op(task.getProcessInstanceId(), taskId, task.getTaskDefinitionKey(), task.getName(), ctx,
                WfOperation.ACTION_COUNTER_SIGN, req.comment(), Map.of("users", users));
    }

    /* ---------------- 减签 ---------------- */

    @Transactional
    public void reduceSign(String taskId, ReduceSignRequest req) {
        UserContext ctx = WfSupport.currentUser();
        Task task = requireMyTask(taskId, ctx);
        requireAllowedOp(task, "reduceSign");
        String pid = task.getProcessInstanceId();
        String node = task.getTaskDefinitionKey();
        List<Long> removeIds = req.removeUserIds() == null ? List.of() : req.removeUserIds();
        if (removeIds.isEmpty()) {
            throw new BusinessException(400, "请指定要减签的处理人");
        }
        List<Task> nodeTasks = taskService.createTaskQuery().processInstanceId(pid)
                .taskDefinitionKey(node).active().list();
        List<Task> toRemove = nodeTasks.stream()
                .filter(t -> removeIds.contains(parseLong(t.getAssignee())))
                .toList();
        if (toRemove.isEmpty()) {
            throw new BusinessException(400, "未找到可减签的处理人（可能已办理）");
        }
        if (nodeTasks.size() - toRemove.size() < 1) {
            throw new BusinessException(400, "减签后本节点至少需保留 1 名处理人");
        }
        for (Task t : toRemove) {
            runtimeService.deleteMultiInstanceExecution(t.getExecutionId(), false);
        }
        audit.op(pid, taskId, node, task.getName(), ctx, WfOperation.ACTION_REDUCE_SIGN, null,
                Map.of("removed", removeIds));
    }

    /* ---------------- 转办 ---------------- */

    @Transactional
    public void transfer(String taskId, AssigneeRequest req) {
        UserContext ctx = WfSupport.currentUser();
        Task task = requireMyTask(taskId, ctx);
        requireAllowedOp(task, "transfer");
        Long to = singleUser(req.user());
        taskService.setOwner(taskId, String.valueOf(ctx.getUserId()));
        taskService.setAssignee(taskId, String.valueOf(to));
        audit.op(task.getProcessInstanceId(), taskId, task.getTaskDefinitionKey(), task.getName(), ctx,
                WfOperation.ACTION_TRANSFER, req.comment(), Map.of("to", to));
        audit.notify(to, com.xingchen.oa.workflow.entity.WfNotify.TYPE_TODO, "转办待办：" + task.getName(),
                WfSupport.displayName(ctx) + " 将任务「" + task.getName() + "」转办给您", task.getProcessInstanceId());
    }

    /* ---------------- 委派 ---------------- */

    @Transactional
    public void delegate(String taskId, AssigneeRequest req) {
        UserContext ctx = WfSupport.currentUser();
        Task task = requireMyTask(taskId, ctx);
        requireAllowedOp(task, "delegate");
        Long to = singleUser(req.user());
        taskService.delegateTask(taskId, String.valueOf(to));
        audit.op(task.getProcessInstanceId(), taskId, task.getTaskDefinitionKey(), task.getName(), ctx,
                WfOperation.ACTION_DELEGATE, req.comment(), Map.of("to", to));
        audit.notify(to, com.xingchen.oa.workflow.entity.WfNotify.TYPE_TODO, "委派待办：" + task.getName(),
                WfSupport.displayName(ctx) + " 委派任务「" + task.getName() + "」给您，办理后将回到委派人确认",
                task.getProcessInstanceId());
    }

    /* ---------------- 拿回（下节点未处理前取回） ---------------- */

    @Transactional
    public void retrieve(String taskId, RetrieveRequest req) {
        UserContext ctx = WfSupport.currentUser();
        HistoricTaskInstance mine = historyService.createHistoricTaskInstanceQuery()
                .taskId(taskId).singleResult();
        if (mine == null || mine.getEndTime() == null) {
            throw new BusinessException(404, "已办任务不存在或未完成");
        }
        if (!Objects.equals(mine.getAssignee(), String.valueOf(ctx.getUserId()))) {
            throw new BusinessException(403, "只能拿回本人已办任务");
        }
        String pid = mine.getProcessInstanceId();
        String myNode = mine.getTaskDefinitionKey();
        // flowConfig.operations.retrieve 开关：关闭则不可拿回
        instanceRepository.findByProcInstId(pid)
                .ifPresent(inst -> requireOperationEnabled(inst.getDefCode(), "retrieve"));
        if (runtimeService.createProcessInstanceQuery().processInstanceId(pid).count() == 0) {
            throw new BusinessException(400, "流程已结束，无法拿回");
        }
        // 下一节点尚未有人处理：我之后没有已完成的其他节点任务
        long nextActed = historyService.createHistoricTaskInstanceQuery().processInstanceId(pid).finished().list()
                .stream()
                .filter(t -> t.getEndTime() != null && mine.getEndTime() != null
                        && t.getEndTime().after(mine.getEndTime())
                        && !Objects.equals(t.getTaskDefinitionKey(), myNode))
                .count();
        if (nextActed > 0) {
            throw new BusinessException(400, "下一节点已有处理记录，无法拿回");
        }
        List<String> activeNodes = runtimeService.createExecutionQuery().processInstanceId(pid).list()
                .stream().map(Execution::getActivityId).filter(Objects::nonNull).distinct().toList();
        try {
            runtimeService.createChangeActivityStateBuilder()
                    .processInstanceId(pid)
                    .moveActivityIdsToSingleActivityId(activeNodes, myNode)
                    .changeState();
        } catch (Exception e) {
            throw new BusinessException(400, "拿回失败：" + e.getMessage());
        }
        // 置回本人办理
        taskService.createTaskQuery().processInstanceId(pid).taskDefinitionKey(myNode).active().list()
                .forEach(t -> taskService.setAssignee(t.getId(), String.valueOf(ctx.getUserId())));
        audit.op(pid, taskId, myNode, mine.getName(), ctx, WfOperation.ACTION_RETRIEVE,
                req != null ? req.comment() : null);
    }

    /* ---------------- helpers ---------------- */

    private Task requireMyTask(String taskId, UserContext ctx) {
        Task task = taskService.createTaskQuery().taskId(taskId).active().singleResult();
        if (task == null) {
            throw new BusinessException(404, "任务不存在或已处理");
        }
        String me = String.valueOf(ctx.getUserId());
        if (Objects.equals(task.getAssignee(), me)) {
            return task;
        }
        // 允许候选人（代理/认领）操作
        boolean candidate = taskService.getIdentityLinksForTask(taskId).stream()
                .anyMatch(l -> me.equals(l.getUserId()));
        if (candidate) {
            return task;
        }
        throw new BusinessException(403, "非当前办理人，无权操作该任务");
    }

    /**
     * addMultiInstanceExecution 的 parentExecutionId：应为「多实例根执行」的父执行
     * （引擎在该父执行的子执行中查找 activityId 匹配且 isMultiInstanceRoot 的 MI 根）。
     * 并行多实例结构：父执行 → MI 根执行(activityId=节点) → N 个子执行(activityId=节点)；
     * MI 根 id 会作为子执行的 parentId 出现，故先定位 MI 根再取其父。
     */
    private String miRootExecutionId(Task task) {
        // 叶子执行(userTask 所在) → 父执行(MI 根) → 其父(MI 根的父)，作为 addMultiInstanceExecution 的入参
        Execution leaf = runtimeService.createExecutionQuery()
                .executionId(task.getExecutionId()).singleResult();
        if (leaf == null || leaf.getParentId() == null) {
            throw new BusinessException(400, "当前节点不支持加签（非多实例节点）");
        }
        Execution miRoot = runtimeService.createExecutionQuery()
                .executionId(leaf.getParentId()).singleResult();
        if (miRoot == null || miRoot.getParentId() == null) {
            throw new BusinessException(400, "当前节点不支持加签（非多实例节点）");
        }
        return miRoot.getParentId();
    }

    private void moveTo(String pid, String targetNode) {
        List<String> activeNodes = runtimeService.createExecutionQuery().processInstanceId(pid).list()
                .stream().map(Execution::getActivityId).filter(Objects::nonNull).distinct().toList();
        runtimeService.createChangeActivityStateBuilder()
                .processInstanceId(pid)
                .moveActivityIdsToSingleActivityId(activeNodes, targetNode)
                .changeState();
    }

    private String previousUserTaskNode(String pid, String currentNode) {
        List<HistoricTaskInstance> finished = historyService.createHistoricTaskInstanceQuery()
                .processInstanceId(pid).finished()
                .orderByHistoricTaskInstanceEndTime().desc().list();
        for (HistoricTaskInstance t : finished) {
            if (!Objects.equals(t.getTaskDefinitionKey(), currentNode)) {
                return t.getTaskDefinitionKey();
            }
        }
        return null;
    }

    private List<Long> resolveUsers(List<OrgRef> refs) {
        if (refs == null || refs.isEmpty()) {
            throw new BusinessException(400, "请选择处理人");
        }
        return assigneeResolver.resolveRefsStrict(objectMapper.valueToTree(refs));
    }

    private Long singleUser(OrgRef ref) {
        List<Long> ids = resolveUsers(ref == null ? List.of() : List.of(ref));
        if (ids.isEmpty()) {
            throw new BusinessException(400, "目标处理人无效");
        }
        return ids.get(0);
    }

    private void updateInstanceForm(String pid, Map<String, Object> formData) {
        instanceRepository.findByProcInstId(pid).ifPresent(inst -> {
            try {
                inst.setFormDataJson(objectMapper.writeValueAsString(formData));
                instanceRepository.save(inst);
            } catch (Exception ignored) {
                // 表单更新失败不阻断审批
            }
        });
    }

    private Map<String, Object> attachDetail(TaskActionRequest req) {
        if (req != null && req.attachments() != null && !req.attachments().isEmpty()) {
            return Map.of("attachments", req.attachments());
        }
        return null;
    }

    private void putScalarVars(Map<String, Object> vars, Map<String, Object> formData) {
        formData.forEach((k, v) -> {
            if (v == null || v instanceof Number || v instanceof String || v instanceof Boolean) {
                vars.put(k, v);
            }
        });
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

    /**
     * allowedOps 服务端强制：读节点扩展 oa:allowedOps 白名单，操作不在白名单内即 403。
     * 无 allowedOps（缺省）= 全放行。防止仅靠前端 UI 约束被绕过。
     */
    private void requireAllowedOp(Task task, String op) {
        List<String> allowed = allowedOpsOfNode(task.getProcessDefinitionId(), task.getTaskDefinitionKey());
        if (allowed != null && !allowed.contains(op)) {
            throw new BusinessException(403, "当前节点不允许「" + op + "」操作");
        }
    }

    /** 读节点 allowedOps 白名单；无配置返回 null（=不限制）。 */
    private List<String> allowedOpsOfNode(String procDefId, String nodeKey) {
        try {
            FlowElement fe = repositoryService.getBpmnModel(procDefId)
                    .getMainProcess().getFlowElement(nodeKey, true);
            if (fe != null && fe.getExtensionElements() != null) {
                List<ExtensionElement> list = fe.getExtensionElements().get("allowedOps");
                if (list != null && !list.isEmpty() && StringUtils.hasText(list.get(0).getElementText())) {
                    var node = objectMapper.readTree(list.get(0).getElementText());
                    if (node.isArray()) {
                        List<String> ops = new java.util.ArrayList<>();
                        node.forEach(n -> ops.add(n.asString("")));
                        return ops;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("读取节点 allowedOps 失败 node={}: {}", nodeKey, e.getMessage());
        }
        return null;
    }

    /** flowConfig.operations 开关：关闭对应流程级操作则 403（缺省=允许）。 */
    private void requireOperationEnabled(String defCode, String opKey) {
        if (defCode == null) {
            return;
        }
        WfProcessExt def = processRepository.findByDefCode(defCode).orElse(null);
        if (def == null) {
            return;
        }
        try {
            String json = StringUtils.hasText(def.getFlowConfig()) ? def.getFlowConfig()
                    : (StringUtils.hasText(def.getDesignerJson()) ? def.getDesignerJson() : null);
            if (json == null) {
                return;
            }
            var root = objectMapper.readTree(json);
            var fc = StringUtils.hasText(def.getFlowConfig()) ? root : root.path("flowConfig");
            var op = fc.path("operations").path(opKey);
            if (op != null && !op.isMissingNode() && !op.isNull() && !op.asBoolean(true)) {
                throw new BusinessException(403, "该流程已关闭「" + opKey + "」操作");
            }
        } catch (BusinessException be) {
            throw be;
        } catch (Exception e) {
            log.warn("读取 flowConfig.operations 失败 defCode={}: {}", defCode, e.getMessage());
        }
    }

    /** 节点是否要求审批意见必填（读节点扩展 oa:commentRequired）。 */
    private boolean commentRequired(Task task) {
        try {
            FlowElement fe = repositoryService.getBpmnModel(task.getProcessDefinitionId())
                    .getMainProcess().getFlowElement(task.getTaskDefinitionKey(), true);
            if (fe == null || fe.getExtensionElements() == null) {
                return false;
            }
            List<ExtensionElement> list = fe.getExtensionElements().get("commentRequired");
            if (list == null || list.isEmpty()) {
                return false;
            }
            return "true".equalsIgnoreCase(list.get(0).getElementText());
        } catch (Exception e) {
            return false;
        }
    }
}
