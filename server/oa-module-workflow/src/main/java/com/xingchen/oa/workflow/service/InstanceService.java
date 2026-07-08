package com.xingchen.oa.workflow.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.workflow.dto.CcItem;
import com.xingchen.oa.workflow.dto.InstanceDetailResponse;
import com.xingchen.oa.workflow.dto.InstanceDetailResponse.AssigneeInfo;
import com.xingchen.oa.workflow.dto.InstanceDetailResponse.CommentItem;
import com.xingchen.oa.workflow.dto.InstanceDetailResponse.CurrentNode;
import com.xingchen.oa.workflow.dto.InstanceDetailResponse.Highlight;
import com.xingchen.oa.workflow.dto.InstanceDetailResponse.JumpTarget;
import com.xingchen.oa.workflow.dto.InstanceDetailResponse.SubInstance;
import com.xingchen.oa.workflow.dto.InstanceDetailResponse.TimelineItem;
import com.xingchen.oa.workflow.dto.InstanceListItem;
import com.xingchen.oa.workflow.dto.P2Requests.CommentRequest;
import com.xingchen.oa.workflow.dto.P2Requests.DraftRequest;
import com.xingchen.oa.workflow.dto.P2Requests.HandoverRequest;
import com.xingchen.oa.workflow.dto.P2Requests.JumpRequest;
import com.xingchen.oa.workflow.dto.P3Requests.PredictResponse;
import com.xingchen.oa.workflow.dto.P3Requests.PredictResponse.AssigneeName;
import com.xingchen.oa.workflow.dto.P3Requests.PredictResponse.PredictNode;
import com.xingchen.oa.workflow.dto.P3Requests.ResurrectRequest;
import com.xingchen.oa.workflow.engine.AssigneeResolver;
import com.xingchen.oa.workflow.convert.ConditionEvaluator;
import com.xingchen.oa.workflow.dto.StartInstanceRequest;
import com.xingchen.oa.workflow.dto.StartableItem;
import com.xingchen.oa.workflow.entity.WfNotify;
import com.xingchen.oa.workflow.support.WfAudit;
import com.xingchen.oa.workflow.entity.WfCc;
import com.xingchen.oa.workflow.entity.WfFormDef;
import com.xingchen.oa.workflow.entity.WfInstanceExt;
import com.xingchen.oa.workflow.entity.WfOperation;
import com.xingchen.oa.workflow.entity.WfProcessExt;
import com.xingchen.oa.workflow.repository.WfCcRepository;
import com.xingchen.oa.workflow.repository.WfFormDefRepository;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import com.xingchen.oa.workflow.repository.WfOperationRepository;
import com.xingchen.oa.workflow.repository.WfProcessExtRepository;
import com.xingchen.oa.workflow.repository.WfTaskReadRepository;
import com.xingchen.oa.workflow.support.UserNameResolver;
import com.xingchen.oa.workflow.support.WfSupport;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.UserTask;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.history.HistoricActivityInstance;
import org.flowable.engine.history.HistoricProcessInstance;
import org.flowable.engine.runtime.Execution;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.task.api.Task;
import org.flowable.engine.TaskService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 流程实例运行时：发起 / 我发起 / 详情 / 撤销 / 抄送 / 重提。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InstanceService {

    private final WfProcessExtRepository processRepository;
    private final WfFormDefRepository formRepository;
    private final WfInstanceExtRepository instanceRepository;
    private final WfOperationRepository operationRepository;
    private final WfCcRepository ccRepository;
    private final WfTaskReadRepository taskReadRepository;
    private final RuntimeService runtimeService;
    private final TaskService taskService;
    private final HistoryService historyService;
    private final RepositoryService repositoryService;
    private final UserNameResolver nameResolver;
    private final AssigneeResolver assigneeResolver;
    private final WfAudit audit;
    private final ObjectMapper objectMapper;

    public static final String PERM_INSTANCE_ADMIN = "wf:instance:admin";

    /* ---------------- 可发起 ---------------- */

    public List<StartableItem> startable() {
        Long uid = WfSupport.currentUser().getUserId();
        return processRepository.findByStatusOrderByIdAsc(WfProcessExt.STATUS_PUBLISHED).stream()
                .filter(p -> inStartScope(p, uid))
                .map(p -> new StartableItem(p.getDefCode(), p.getName(), p.getCategory(), p.getIcon(),
                        p.getFormCode(), p.getFormVersion(), formSchema(p.getFormCode(), p.getFormVersion()),
                        p.getFormType(), p.getFormSubmitPath(), p.getFormViewPath()))
                .toList();
    }

    /**
     * 发起权限：flowConfig.start.scope 为空/缺省 = 不限（人人可发起）；
     * 否则当前用户须落在 scope（OrgRef 用户/角色/部门展开的成员集合）内。
     */
    private boolean inStartScope(WfProcessExt def, Long userId) {
        JsonNode fc = flowConfigOf(def);
        if (fc == null) {
            return true;
        }
        JsonNode scope = fc.path("start").path("scope");
        if (scope == null || !scope.isArray() || scope.isEmpty()) {
            return true;
        }
        return assigneeResolver.resolveRefs(scope).contains(userId);
    }

    private String formSchema(String code, Integer version) {
        if (!StringUtils.hasText(code)) {
            return null;
        }
        return (version != null
                ? formRepository.findByCodeAndVersion(code, version)
                : formRepository.findTopByCodeOrderByVersionDesc(code))
                .map(WfFormDef::getSchemaJson).orElse(null);
    }

    /* ---------------- 发起 ---------------- */

    @Transactional
    public InstanceDetailResponse start(StartInstanceRequest req) {
        UserContext ctx = WfSupport.currentUser();
        WfProcessExt def = processRepository.findByDefCode(req.defCode())
                .orElseThrow(() -> new BusinessException(404, "流程不存在: " + req.defCode()));
        if (!WfProcessExt.STATUS_PUBLISHED.equals(def.getStatus())) {
            throw new BusinessException(400, "流程未发布，不可发起");
        }
        // 发起权限：flowConfig.start.scope 限定的发起范围（空=不限）
        if (!inStartScope(def, ctx.getUserId())) {
            throw new BusinessException(403, "您不在该流程的发起范围内");
        }
        Map<String, Object> formData = req.formData() == null ? Map.of() : req.formData();
        String initiatorName = WfSupport.displayName(ctx);

        Map<String, Object> vars = new LinkedHashMap<>();
        vars.put("initiatorId", ctx.getUserId());
        vars.put("initiatorDeptId", ctx.getActiveDeptId());
        vars.put("initiatorName", initiatorName);
        putScalarVars(vars, formData);

        // P3 流程高级：flowConfig.variables 发起时注入流程变量（不覆盖表单同名字段）
        JsonNode flowConfig = flowConfigOf(def);
        injectFlowVariables(vars, flowConfig);

        // P3 流程高级：taskTitle fx 模板插值表单字段生成实例标题（未显式传 title 时）
        String title;
        if (StringUtils.hasText(req.title())) {
            title = req.title();
        } else {
            String tpl = flowConfig != null ? flowConfig.path("start").path("taskTitle").asString(null) : null;
            title = StringUtils.hasText(tpl)
                    ? interpolateTitle(tpl, formData, initiatorName)
                    : initiatorName + "的" + def.getName();
        }

        ProcessInstance pi = startEngine(req.defCode(), vars);

        WfInstanceExt inst = new WfInstanceExt();
        inst.setProcInstId(pi.getId());
        inst.setDefCode(def.getDefCode());
        inst.setDefName(def.getName());
        inst.setTitle(title);
        inst.setInitiatorId(ctx.getUserId());
        inst.setInitiatorName(initiatorName);
        inst.setInitiatorDeptId(ctx.getActiveDeptId());
        inst.setFormCode(def.getFormCode());
        inst.setFormVersion(def.getFormVersion());
        inst.setFormSchemaSnapshot(formSchema(def.getFormCode(), def.getFormVersion()));
        inst.setFormDataJson(toJson(formData));
        inst.setBizTime(parseBizTime(req.bizTime())); // P3 穿越时空：补审业务时间
        inst.setBizStatus(runtimeEnded(pi.getId()) ? endedStatus(pi.getId()) : WfInstanceExt.STATUS_RUNNING);
        WfInstanceExt saved = instanceRepository.save(inst);

        operation(pi.getId(), null, "start", "发起", ctx, WfOperation.ACTION_SUBMIT, null, saved.getBizTime());
        return detail(saved.getId());
    }

    /* ---------------- 列表 ---------------- */

    public PageResult<InstanceListItem> my(int pageNum, int pageSize) {
        Long uid = WfSupport.currentUser().getUserId();
        Page<WfInstanceExt> page = instanceRepository.findByInitiatorId(uid,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        return new PageResult<>(page.getContent().stream().map(InstanceListItem::of).toList(),
                page.getTotalElements(), pageNum, pageSize);
    }

    /* ---------------- 详情 ---------------- */

    @Transactional
    public InstanceDetailResponse detail(Long id) {
        WfInstanceExt inst = instanceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));
        return buildDetail(inst);
    }

    public InstanceDetailResponse detailByProcInstId(String procInstId) {
        WfInstanceExt inst = instanceRepository.findByProcInstId(procInstId)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));
        return buildDetail(inst);
    }

    private InstanceDetailResponse buildDetail(WfInstanceExt inst) {
        Long currentUserId = WfSupport.currentUser().getUserId();
        String pid = inst.getProcInstId();

        // 打开即记抄送已读（失败不阻断详情）
        try {
            markCcRead(pid, currentUserId);
        } catch (Exception e) {
            log.warn("标记抄送已读失败 pid={}: {}", pid, e.getMessage());
        }

        // 当前活动任务（引擎运行时可能因异步流转处于瞬时状态，防御式读取）
        Map<String, CurrentNode> nodeMap = new LinkedHashMap<>();
        String myTaskId = null;
        String myNode = null;
        List<Task> activeTasks = new ArrayList<>();
        try {
            activeTasks = taskService.createTaskQuery().processInstanceId(pid).active().list();
            for (Task t : activeTasks) {
                AssigneeInfo ai = new AssigneeInfo(t.getAssignee(),
                        nameResolver.nameOf(t.getAssignee()), "ACTIVE");
                CurrentNode node = nodeMap.computeIfAbsent(t.getTaskDefinitionKey(),
                        k -> new CurrentNode(k, t.getName(), new ArrayList<>()));
                node.assignees().add(ai);
                if (Objects.equals(t.getAssignee(), String.valueOf(currentUserId))) {
                    myTaskId = t.getId();
                    myNode = t.getTaskDefinitionKey();
                }
            }
        } catch (Exception e) {
            log.warn("读取当前任务失败 pid={}: {}", pid, e.getMessage());
        }

        // 本节点其他待办处理人（供减签勾选）：我所在节点、除我以外的活动任务处理人
        List<InstanceDetailResponse.Handler> currentHandlers = new ArrayList<>();
        for (Task t : activeTasks) {
            if (Objects.equals(t.getId(), myTaskId)) {
                continue;
            }
            if (myNode != null && !Objects.equals(t.getTaskDefinitionKey(), myNode)) {
                continue;
            }
            Long uid = parseLong(t.getAssignee());
            if (uid == null) {
                continue;
            }
            currentHandlers.add(new InstanceDetailResponse.Handler(uid,
                    nameResolver.nameOf(t.getAssignee()), t.getId()));
        }

        List<TimelineItem> timeline = List.of();
        try {
            timeline = operationRepository.findByProcInstIdOrderByCreatedAtAsc(pid).stream()
                    .map(o -> new TimelineItem(o.getNodeId(), o.getNodeName(), o.getActorName(),
                            o.getAction(), o.getComment(), o.getCreatedAt()))
                    .toList();
        } catch (Exception e) {
            log.warn("读取时间线失败 pid={}: {}", pid, e.getMessage());
        }

        Set<String> completed = new LinkedHashSet<>();
        Set<String> active = new LinkedHashSet<>();
        try {
            for (HistoricActivityInstance a : historyService.createHistoricActivityInstanceQuery()
                    .processInstanceId(pid).list()) {
                if (a.getActivityId() == null) {
                    continue;
                }
                if (a.getEndTime() != null) {
                    completed.add(a.getActivityId());
                } else {
                    active.add(a.getActivityId());
                }
            }
            for (Execution ex : runtimeService.createExecutionQuery().processInstanceId(pid).list()) {
                if (ex.getActivityId() != null) {
                    active.add(ex.getActivityId());
                }
            }
        } catch (Exception e) {
            log.warn("计算流程高亮失败 pid={}: {}", pid, e.getMessage());
        }

        boolean hasCompletedUserTask = false;
        try {
            hasCompletedUserTask = historyService.createHistoricTaskInstanceQuery()
                    .processInstanceId(pid).finished().count() > 0;
        } catch (Exception e) {
            log.warn("统计已完成任务失败 pid={}: {}", pid, e.getMessage());
        }
        boolean canCancel = Objects.equals(inst.getInitiatorId(), currentUserId)
                && WfInstanceExt.STATUS_RUNNING.equals(inst.getBizStatus())
                && !hasCompletedUserTask;

        // P2：管理员标记 / 我当前任务可用操作 / 可跳转节点 / 沟通线程
        boolean isAdmin = hasInstanceAdmin();
        List<String> allowedOps = myTaskId == null ? List.of() : allowedOpsOf(pid, myNode);
        List<JumpTarget> jumpTargets = (isAdmin || myTaskId != null) ? userTaskNodes(pid) : List.of();
        List<CommentItem> comments = communicateThread(pid);
        boolean readByMe = false;
        try {
            readByMe = taskReadRepository.existsByProcInstIdAndUserId(pid, currentUserId);
        } catch (Exception ignored) {
            // 已阅查询失败不阻断详情
        }

        // P3：子流程入口 / 节点表单权限 / 预测&唤醒可用性 / 业务时间
        List<SubInstance> subInstances = subInstancesOf(pid);
        String detailNode = myNode != null ? myNode
                : (nodeMap.isEmpty() ? null : nodeMap.keySet().iterator().next());
        Map<String, String> nodeFormPerms = formPermsOf(pid, detailNode);
        // P2：当前节点办理选项 + 审核菜单透传（供前端渲染候选/历史优先/自动跳过 + JUMP/RETURN 按钮）
        Map<String, Object> nodeHandleOptions = nodeExtMap(pid, detailNode, "handleOptions");
        Object auditMenu = nodeExtObject(pid, detailNode, "auditMenu");
        boolean running = WfInstanceExt.STATUS_RUNNING.equals(inst.getBizStatus());
        boolean resurrectable = WfInstanceExt.STATUS_APPROVED.equals(inst.getBizStatus())
                || WfInstanceExt.STATUS_REJECTED.equals(inst.getBizStatus())
                || WfInstanceExt.STATUS_TERMINATED.equals(inst.getBizStatus())
                || WfInstanceExt.STATUS_CANCELED.equals(inst.getBizStatus());
        // 业务时间按服务器本地时区展示（timestamptz 存 instant，回读为 UTC，需还原本地日期）
        String bizTime = inst.getBizTime() != null
                ? inst.getBizTime().atZoneSameInstant(java.time.ZoneId.systemDefault()).toOffsetDateTime().toString()
                : null;
        List<InstanceDetailResponse.SealUse> seals = sealUsesOf(pid);

        // P1-C：自定义表单类型/查看路径（供前端按类型渲染动态表单或路由到自定义页面）
        WfProcessExt def = processRepository.findByDefCode(inst.getDefCode()).orElse(null);
        // flowConfig.operations.cancel 关闭时，撤销按钮不可用
        if (canCancel && def != null && !operationEnabled(def, "cancel")) {
            canCancel = false;
        }
        String formType = def != null && StringUtils.hasText(def.getFormType())
                ? def.getFormType() : WfProcessExt.FORM_DYNAMIC;
        String formViewPath = def != null ? def.getFormViewPath() : null;

        // 跟踪图分流：DINGTALK 定义额外回传 designerJson（钉钉模型），前端据 designerType 选钉钉跟踪图 / bpmn 图
        String designerType = def != null && StringUtils.hasText(def.getDesignerType())
                ? def.getDesignerType() : WfProcessExt.TYPE_DINGTALK;
        Object designerJson = def != null && WfProcessExt.TYPE_DINGTALK.equals(designerType)
                && StringUtils.hasText(def.getDesignerJson())
                ? parseJson(def.getDesignerJson()) : null;

        return new InstanceDetailResponse(
                inst.getId(), pid, inst.getDefCode(), inst.getDefName(), inst.getTitle(), inst.getBizStatus(),
                inst.getInitiatorId(), inst.getInitiatorName(), inst.getCreatedAt(), inst.getEndedAt(),
                inst.getFormSchemaSnapshot(), parseJson(inst.getFormDataJson()),
                new ArrayList<>(nodeMap.values()), timeline,
                new Highlight(new ArrayList<>(completed), new ArrayList<>(active)),
                processBpmn(inst.getDefCode()), canCancel, myTaskId,
                allowedOps, isAdmin, jumpTargets, comments, readByMe, currentHandlers,
                subInstances, running, resurrectable, seals, bizTime, nodeFormPerms,
                formType, formViewPath, nodeHandleOptions, auditMenu,
                designerType, designerJson);
    }

    /** 读当前节点某扩展元素并解析为 Map（handleOptions 等）；失败返回空 Map。 */
    private Map<String, Object> nodeExtMap(String pid, String nodeId, String extName) {
        Object o = nodeExtObject(pid, nodeId, extName);
        if (o instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            m.forEach((k, v) -> out.put(String.valueOf(k), v));
            return out;
        }
        return Map.of();
    }

    /** 读当前节点某扩展元素并解析为对象（Map/List）；无则 null。 */
    private Object nodeExtObject(String pid, String nodeId, String extName) {
        if (nodeId == null) {
            return null;
        }
        try {
            String procDefId = runtimeService.createProcessInstanceQuery().processInstanceId(pid)
                    .singleResult().getProcessDefinitionId();
            BpmnModel model = repositoryService.getBpmnModel(procDefId);
            FlowElement fe = model.getMainProcess().getFlowElement(nodeId, true);
            if (fe != null && fe.getExtensionElements() != null) {
                List<ExtensionElement> list = fe.getExtensionElements().get(extName);
                if (list != null && !list.isEmpty() && StringUtils.hasText(list.get(0).getElementText())) {
                    return parseJson(list.get(0).getElementText());
                }
            }
        } catch (Exception e) {
            log.warn("读取节点扩展 {} 失败 pid={} node={}: {}", extName, pid, nodeId, e.getMessage());
        }
        return null;
    }

    /* ---------------- P3 详情辅助 ---------------- */

    /** 子流程入口：主流程 CallActivity 触发的子流程实例（活动 + 历史）。 */
    private List<SubInstance> subInstancesOf(String pid) {
        List<SubInstance> out = new ArrayList<>();
        try {
            for (HistoricActivityInstance a : historyService.createHistoricActivityInstanceQuery()
                    .processInstanceId(pid).activityType("callActivity").list()) {
                String subId = a.getCalledProcessInstanceId();
                if (subId == null) {
                    continue;
                }
                HistoricProcessInstance child = historyService.createHistoricProcessInstanceQuery()
                        .processInstanceId(subId).singleResult();
                String title = child != null && child.getProcessDefinitionName() != null
                        ? child.getProcessDefinitionName() : subId;
                String status = (child != null && child.getEndTime() != null)
                        ? WfInstanceExt.STATUS_APPROVED : WfInstanceExt.STATUS_RUNNING;
                out.add(new SubInstance(a.getActivityId(), subId, title, status));
            }
        } catch (Exception e) {
            log.warn("读取子流程入口失败 pid={}: {}", pid, e.getMessage());
        }
        return out;
    }

    /** 当前节点的表单字段权限（HIDDEN/READ/EDIT），供前端 FormRenderer 按节点显隐/只读。 */
    private Map<String, String> formPermsOf(String pid, String nodeId) {
        if (nodeId == null) {
            return Map.of();
        }
        try {
            String procDefId = runtimeService.createProcessInstanceQuery().processInstanceId(pid)
                    .singleResult().getProcessDefinitionId();
            BpmnModel model = repositoryService.getBpmnModel(procDefId);
            FlowElement fe = model.getMainProcess().getFlowElement(nodeId, true);
            if (fe != null && fe.getExtensionElements() != null) {
                List<ExtensionElement> list = fe.getExtensionElements().get("formPerms");
                if (list != null && !list.isEmpty() && StringUtils.hasText(list.get(0).getElementText())) {
                    Object parsed = parseJson(list.get(0).getElementText());
                    if (parsed instanceof Map<?, ?> m) {
                        Map<String, String> out = new LinkedHashMap<>();
                        m.forEach((k, v) -> out.put(String.valueOf(k), String.valueOf(v)));
                        return out;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("读取节点 formPerms 失败 pid={} node={}: {}", pid, nodeId, e.getMessage());
        }
        return Map.of();
    }

    /** 已用电子章：从 wf_operation 的 SEAL 动作聚合（打印/盖章展示用）。 */
    private List<InstanceDetailResponse.SealUse> sealUsesOf(String pid) {
        List<InstanceDetailResponse.SealUse> out = new ArrayList<>();
        try {
            operationRepository.findByProcInstIdOrderByCreatedAtAsc(pid).stream()
                    .filter(o -> "SEAL".equals(o.getAction()))
                    .forEach(o -> out.add(new InstanceDetailResponse.SealUse(
                            o.getNodeName(), o.getComment(), o.getActorName(), o.getCreatedAt())));
        } catch (Exception ignored) {
            // 盖章记录读取失败不阻断详情
        }
        return out;
    }

    /* ---------------- P2：管理员治理（跳转/终止/催办/实例列表） ---------------- */

    @Transactional
    public InstanceDetailResponse jump(Long id, JumpRequest req) {
        requireInstanceAdmin();
        WfInstanceExt inst = instanceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));
        if (!WfInstanceExt.STATUS_RUNNING.equals(inst.getBizStatus())) {
            throw new BusinessException(400, "仅运行中实例可跳转");
        }
        String pid = inst.getProcInstId();
        List<String> activeNodes = runtimeService.createExecutionQuery().processInstanceId(pid).list()
                .stream().map(Execution::getActivityId).filter(Objects::nonNull).distinct().toList();
        try {
            runtimeService.createChangeActivityStateBuilder().processInstanceId(pid)
                    .moveActivityIdsToSingleActivityId(activeNodes, req.targetNodeId())
                    .changeState();
        } catch (Exception e) {
            throw new BusinessException(400, "跳转失败：" + e.getMessage());
        }
        audit.op(pid, null, req.targetNodeId(), null, WfSupport.currentUser(),
                WfOperation.ACTION_JUMP, req.comment(), Map.of("target", req.targetNodeId()));
        return buildDetail(inst);
    }

    @Transactional
    public InstanceDetailResponse terminate(Long id, CommentRequest req) {
        requireInstanceAdmin();
        WfInstanceExt inst = instanceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));
        requireOperationEnabled(inst.getDefCode(), "terminate");
        if (!WfInstanceExt.STATUS_RUNNING.equals(inst.getBizStatus())) {
            throw new BusinessException(400, "仅运行中实例可终止");
        }
        runtimeService.deleteProcessInstance(inst.getProcInstId(),
                "管理员终止" + (req != null && req.comment() != null ? "：" + req.comment() : ""));
        inst.setBizStatus(WfInstanceExt.STATUS_TERMINATED);
        inst.setEndedAt(OffsetDateTime.now());
        instanceRepository.save(inst);
        audit.op(inst.getProcInstId(), null, "end", "终止", WfSupport.currentUser(),
                WfOperation.ACTION_TERMINATE, req != null ? req.comment() : null);
        if (inst.getInitiatorId() != null) {
            audit.notify(inst.getInitiatorId(), WfNotify.TYPE_RESULT, "流程被终止：" + inst.getTitle(),
                    "您发起的流程「" + inst.getTitle() + "」已被管理员终止", inst.getProcInstId());
        }
        return buildDetail(inst);
    }

    @Transactional
    public void urge(Long id, CommentRequest req) {
        WfInstanceExt inst = instanceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));
        requireOperationEnabled(inst.getDefCode(), "urge");
        String pid = inst.getProcInstId();
        List<Task> tasks = taskService.createTaskQuery().processInstanceId(pid).active().list();
        if (tasks.isEmpty()) {
            throw new BusinessException(400, "当前无待办任务，无需催办");
        }
        for (Task t : tasks) {
            Long uid = parseLong(t.getAssignee());
            if (uid != null) {
                audit.notify(uid, WfNotify.TYPE_URGE, "催办：" + inst.getTitle(),
                        "您有一条待办任务「" + t.getName() + "」被催办，请尽快处理", pid);
            }
        }
        audit.op(pid, null, null, null, WfSupport.currentUser(), WfOperation.ACTION_URGE,
                req != null ? req.comment() : null);
    }

    public PageResult<InstanceListItem> adminList(String status, String keyword, int pageNum, int pageSize) {
        requireInstanceAdmin();
        String st = StringUtils.hasText(status) ? status : null;
        String kw = StringUtils.hasText(keyword) ? keyword : null;
        Page<WfInstanceExt> page = instanceRepository.adminSearch(st, kw,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        return new PageResult<>(page.getContent().stream().map(InstanceListItem::of).toList(),
                page.getTotalElements(), pageNum, pageSize);
    }

    /** 离职交接：批量转办某人全部在途任务给接收人【wf:instance:admin】。 */
    @Transactional
    public int handover(HandoverRequest req) {
        requireInstanceAdmin();
        if (req.fromUserId() == null || req.toUserId() == null) {
            throw new BusinessException(400, "交接双方不能为空");
        }
        UserContext ctx = WfSupport.currentUser();
        List<Task> tasks = taskService.createTaskQuery()
                .taskAssignee(String.valueOf(req.fromUserId())).active().list();
        int count = 0;
        for (Task t : tasks) {
            taskService.setOwner(t.getId(), String.valueOf(req.fromUserId()));
            taskService.setAssignee(t.getId(), String.valueOf(req.toUserId()));
            audit.op(t.getProcessInstanceId(), t.getId(), t.getTaskDefinitionKey(), t.getName(), ctx,
                    WfOperation.ACTION_HANDOVER, req.comment(),
                    Map.of("from", req.fromUserId(), "to", req.toUserId()));
            audit.notify(req.toUserId(), WfNotify.TYPE_TODO, "交接待办：" + t.getName(),
                    "离职交接：任务「" + t.getName() + "」已转交给您", t.getProcessInstanceId());
            count++;
        }
        return count;
    }

    /* ---------------- P2-C 暂存草稿（不启动引擎） ---------------- */

    @Transactional
    public InstanceListItem saveDraft(DraftRequest req) {
        UserContext ctx = WfSupport.currentUser();
        WfProcessExt def = processRepository.findByDefCode(req.defCode())
                .orElseThrow(() -> new BusinessException(404, "流程不存在: " + req.defCode()));
        Map<String, Object> formData = req.formData() == null ? Map.of() : req.formData();
        String initiatorName = WfSupport.displayName(ctx);
        WfInstanceExt inst = new WfInstanceExt();
        inst.setProcInstId("DRAFT-" + java.util.UUID.randomUUID());
        inst.setDefCode(def.getDefCode());
        inst.setDefName(def.getName());
        inst.setTitle(StringUtils.hasText(req.title()) ? req.title() : initiatorName + "的" + def.getName() + "(草稿)");
        inst.setInitiatorId(ctx.getUserId());
        inst.setInitiatorName(initiatorName);
        inst.setInitiatorDeptId(ctx.getActiveDeptId());
        inst.setFormCode(def.getFormCode());
        inst.setFormVersion(def.getFormVersion());
        inst.setFormSchemaSnapshot(formSchema(def.getFormCode(), def.getFormVersion()));
        inst.setFormDataJson(toJson(formData));
        inst.setBizStatus(WfInstanceExt.STATUS_DRAFT);
        return InstanceListItem.of(instanceRepository.save(inst));
    }

    @Transactional
    public InstanceListItem updateDraft(Long id, DraftRequest req) {
        UserContext ctx = WfSupport.currentUser();
        WfInstanceExt inst = requireOwnDraft(id, ctx);
        if (req.formData() != null) {
            inst.setFormDataJson(toJson(req.formData()));
        }
        if (StringUtils.hasText(req.title())) {
            inst.setTitle(req.title());
        }
        return InstanceListItem.of(instanceRepository.save(inst));
    }

    @Transactional
    public InstanceDetailResponse submitDraft(Long id, Map<String, Object> formData) {
        UserContext ctx = WfSupport.currentUser();
        WfInstanceExt inst = requireOwnDraft(id, ctx);
        Map<String, Object> data = formData != null ? formData : parseMap(inst.getFormDataJson());

        Map<String, Object> vars = new LinkedHashMap<>();
        vars.put("initiatorId", inst.getInitiatorId());
        vars.put("initiatorDeptId", inst.getInitiatorDeptId());
        vars.put("initiatorName", inst.getInitiatorName());
        putScalarVars(vars, data);

        ProcessInstance pi = startEngine(inst.getDefCode(), vars);
        inst.setProcInstId(pi.getId());
        inst.setFormDataJson(toJson(data));
        inst.setBizStatus(runtimeEnded(pi.getId()) ? endedStatus(pi.getId()) : WfInstanceExt.STATUS_RUNNING);
        instanceRepository.save(inst);
        audit.op(pi.getId(), null, "start", "发起", ctx, WfOperation.ACTION_SUBMIT, null);
        return buildDetail(inst);
    }

    public PageResult<InstanceListItem> drafts(int pageNum, int pageSize) {
        Long uid = WfSupport.currentUser().getUserId();
        Page<WfInstanceExt> page = instanceRepository.findByInitiatorIdAndBizStatus(uid,
                WfInstanceExt.STATUS_DRAFT,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        return new PageResult<>(page.getContent().stream().map(InstanceListItem::of).toList(),
                page.getTotalElements(), pageNum, pageSize);
    }

    private WfInstanceExt requireOwnDraft(Long id, UserContext ctx) {
        WfInstanceExt inst = instanceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "草稿不存在"));
        if (!Objects.equals(inst.getInitiatorId(), ctx.getUserId())) {
            throw new BusinessException(403, "仅本人可操作草稿");
        }
        if (!WfInstanceExt.STATUS_DRAFT.equals(inst.getBizStatus())) {
            throw new BusinessException(400, "该单据非草稿状态");
        }
        return inst;
    }

    /* ---------------- P2 详情辅助 ---------------- */

    private static final List<String> DEFAULT_OPS =
            List.of("approve", "reject", "addSign", "counterSign", "reduceSign",
                    "transfer", "delegate", "assist", "retrieve", "communicate");

    private boolean hasInstanceAdmin() {
        UserContext ctx = WfSupport.currentUser();
        return ctx.getPermissions() != null && ctx.getPermissions().contains(PERM_INSTANCE_ADMIN);
    }

    private void requireInstanceAdmin() {
        if (!hasInstanceAdmin()) {
            throw new BusinessException(403, "需要流程管理员权限（wf:instance:admin）");
        }
    }

    private String myTaskNode(String pid, String myTaskId) {
        if (myTaskId == null) {
            return null;
        }
        Task t = taskService.createTaskQuery().taskId(myTaskId).singleResult();
        return t != null ? t.getTaskDefinitionKey() : null;
    }

    private List<String> allowedOpsOf(String pid, String nodeId) {
        if (nodeId == null) {
            return DEFAULT_OPS;
        }
        try {
            String procDefId = runtimeService.createProcessInstanceQuery().processInstanceId(pid)
                    .singleResult().getProcessDefinitionId();
            BpmnModel model = repositoryService.getBpmnModel(procDefId);
            FlowElement fe = model.getMainProcess().getFlowElement(nodeId, true);
            if (fe != null && fe.getExtensionElements() != null) {
                List<ExtensionElement> list = fe.getExtensionElements().get("allowedOps");
                if (list != null && !list.isEmpty() && StringUtils.hasText(list.get(0).getElementText())) {
                    Object parsed = parseJson(list.get(0).getElementText());
                    if (parsed instanceof List<?> l) {
                        return l.stream().map(String::valueOf).toList();
                    }
                }
            }
        } catch (Exception e) {
            log.warn("读取节点 allowedOps 失败 pid={} node={}: {}", pid, nodeId, e.getMessage());
        }
        return DEFAULT_OPS;
    }

    private List<JumpTarget> userTaskNodes(String pid) {
        try {
            String procDefId = runtimeService.createProcessInstanceQuery().processInstanceId(pid)
                    .singleResult().getProcessDefinitionId();
            BpmnModel model = repositoryService.getBpmnModel(procDefId);
            List<JumpTarget> out = new ArrayList<>();
            for (FlowElement fe : model.getMainProcess().getFlowElements()) {
                if (fe instanceof UserTask ut) {
                    out.add(new JumpTarget(ut.getId(), ut.getName()));
                }
            }
            return out;
        } catch (Exception e) {
            log.warn("读取可跳转节点失败 pid={}: {}", pid, e.getMessage());
            return List.of();
        }
    }

    private List<CommentItem> communicateThread(String pid) {
        try {
            return operationRepository.findByProcInstIdOrderByCreatedAtAsc(pid).stream()
                    .filter(o -> WfOperation.ACTION_COMMUNICATE.equals(o.getAction()))
                    .map(o -> new CommentItem(o.getTaskId(), o.getActorName(), o.getComment(), o.getCreatedAt()))
                    .toList();
        } catch (Exception e) {
            return List.of();
        }
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

    /* ---------------- 撤销 ---------------- */

    @Transactional
    public InstanceDetailResponse cancel(Long id) {
        UserContext ctx = WfSupport.currentUser();
        WfInstanceExt inst = instanceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));
        if (!Objects.equals(inst.getInitiatorId(), ctx.getUserId())) {
            throw new BusinessException(403, "仅发起人可撤销");
        }
        requireOperationEnabled(inst.getDefCode(), "cancel");
        if (!WfInstanceExt.STATUS_RUNNING.equals(inst.getBizStatus())) {
            throw new BusinessException(400, "流程非运行中，不可撤销");
        }
        boolean hasCompletedUserTask = historyService.createHistoricTaskInstanceQuery()
                .processInstanceId(inst.getProcInstId()).finished().count() > 0;
        if (hasCompletedUserTask) {
            throw new BusinessException(400, "已有节点通过，不可撤销");
        }
        runtimeService.deleteProcessInstance(inst.getProcInstId(), "发起人撤销");
        inst.setBizStatus(WfInstanceExt.STATUS_CANCELED);
        inst.setEndedAt(OffsetDateTime.now());
        instanceRepository.save(inst);
        operation(inst.getProcInstId(), null, "start", "发起", ctx, WfOperation.ACTION_CANCEL, null);
        return buildDetail(inst);
    }

    /* ---------------- 重提（退回发起人后） ---------------- */

    @Transactional
    public InstanceDetailResponse resubmit(Long id, Map<String, Object> formData) {
        UserContext ctx = WfSupport.currentUser();
        WfInstanceExt inst = instanceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));
        if (!Objects.equals(inst.getInitiatorId(), ctx.getUserId())) {
            throw new BusinessException(403, "仅发起人可重新提交");
        }
        if (!WfInstanceExt.STATUS_REJECTED.equals(inst.getBizStatus())) {
            throw new BusinessException(400, "仅被退回的流程可重新提交");
        }
        Map<String, Object> data = formData == null ? parseMap(inst.getFormDataJson()) : formData;

        Map<String, Object> vars = new LinkedHashMap<>();
        vars.put("initiatorId", inst.getInitiatorId());
        vars.put("initiatorDeptId", inst.getInitiatorDeptId());
        vars.put("initiatorName", inst.getInitiatorName());
        putScalarVars(vars, data);

        ProcessInstance pi = startEngine(inst.getDefCode(), vars);
        inst.setProcInstId(pi.getId());
        inst.setFormDataJson(toJson(data));
        inst.setEndedAt(null);
        inst.setBizStatus(runtimeEnded(pi.getId()) ? endedStatus(pi.getId()) : WfInstanceExt.STATUS_RUNNING);
        instanceRepository.save(inst);
        operation(pi.getId(), null, "start", "发起", ctx, WfOperation.ACTION_RESUBMIT, null);
        return buildDetail(inst);
    }

    /* ---------------- P3：流程预测（纯计算，不落库） ---------------- */

    @Transactional
    public PredictResponse predict(Long id) {
        WfInstanceExt inst = instanceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));
        WfProcessExt def = processRepository.findByDefCode(inst.getDefCode())
                .orElseThrow(() -> new BusinessException(404, "流程定义不存在"));
        if (!WfProcessExt.TYPE_DINGTALK.equals(def.getDesignerType())
                || !StringUtils.hasText(def.getDesignerJson())) {
            return new PredictResponse(List.of(), "该流程为 BPMN 专业模式，暂不支持静态预测");
        }
        // 求值上下文：表单快照 + 运行时流程变量（审批可能已改表单）
        Map<String, Object> values = new LinkedHashMap<>(parseMap(inst.getFormDataJson()));
        String pid = inst.getProcInstId();
        try {
            if (!runtimeEnded(pid)) {
                runtimeService.getVariables(pid).forEach((k, v) -> {
                    if (v instanceof Number || v instanceof String || v instanceof Boolean) {
                        values.put(k, v);
                    }
                });
            }
        } catch (Exception ignored) {
            // 变量读取失败退化为仅表单值
        }
        // 已完成节点集合（预测只输出后续未完成节点）
        Set<String> completed = new LinkedHashSet<>();
        try {
            for (HistoricActivityInstance a : historyService.createHistoricActivityInstanceQuery()
                    .processInstanceId(pid).list()) {
                if (a.getActivityId() != null && a.getEndTime() != null) {
                    completed.add(a.getActivityId());
                }
            }
        } catch (Exception ignored) {
            // 历史读取失败则不排除已完成节点
        }

        List<PredictNode> path = new ArrayList<>();
        try {
            JsonNode root = objectMapper.readTree(def.getDesignerJson());
            predictWalk(root.path("nodes"), values, inst, completed, path);
        } catch (Exception e) {
            log.warn("流程预测失败 id={}: {}", id, e.getMessage());
        }
        String note = path.isEmpty() ? "无后续节点或流程已结束" : null;
        return new PredictResponse(path, note);
    }

    private void predictWalk(JsonNode nodes, Map<String, Object> values, WfInstanceExt inst,
                             Set<String> completed, List<PredictNode> path) {
        if (nodes == null || !nodes.isArray()) {
            return;
        }
        for (JsonNode node : nodes) {
            String type = node.path("type").asString("");
            String nid = node.path("id").asString("");
            if ("condition".equals(type)) {
                boolean inclusive = "INCLUSIVE".equalsIgnoreCase(node.path("gatewayType").asString("EXCLUSIVE"));
                JsonNode branches = node.path("branches");
                JsonNode defaultBranch = null;
                boolean anyMatched = false;
                for (JsonNode branch : branches) {
                    if (branch.path("default").asBoolean(false)) {
                        defaultBranch = branch;
                        continue;
                    }
                    boolean match = ConditionEvaluator.eval(branch.path("conditions"),
                            branch.path("logic").asString("AND"), values);
                    if (match) {
                        anyMatched = true;
                        predictWalk(branch.path("steps"), values, inst, completed, path);
                        if (!inclusive) {
                            break; // 排它：命中首个即止
                        }
                    }
                }
                if (!anyMatched && defaultBranch != null) {
                    predictWalk(defaultBranch.path("steps"), values, inst, completed, path);
                }
                continue;
            }
            if (completed.contains(nid)) {
                continue; // 已走过的节点不纳入后续预测
            }
            String nodeName = node.path("name").asString(type);
            List<AssigneeName> assignees = List.of();
            if ("approval".equals(type)) {
                List<Long> ids = assigneeResolver.resolveOffline(node.path("assigneeRules"),
                        inst.getInitiatorId(), inst.getInitiatorDeptId(), values);
                assignees = ids.stream()
                        .map(uid -> new AssigneeName(nameResolver.name(uid))).toList();
            }
            path.add(new PredictNode(nid, nodeName, type, assignees));
        }
    }

    /* ---------------- P3：唤醒（已结束实例按快照重建并定位重审） ---------------- */

    @Transactional
    public InstanceDetailResponse resurrect(Long id, ResurrectRequest req) {
        UserContext ctx = WfSupport.currentUser();
        WfInstanceExt inst = instanceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));
        if (WfInstanceExt.STATUS_RUNNING.equals(inst.getBizStatus())
                || WfInstanceExt.STATUS_DRAFT.equals(inst.getBizStatus())) {
            throw new BusinessException(400, "仅已结束实例可唤醒重审");
        }
        if (!StringUtils.hasText(req.nodeId())) {
            throw new BusinessException(400, "唤醒需指定 nodeId");
        }
        Map<String, Object> data = parseMap(inst.getFormDataJson());
        Map<String, Object> vars = new LinkedHashMap<>();
        vars.put("initiatorId", inst.getInitiatorId());
        vars.put("initiatorDeptId", inst.getInitiatorDeptId());
        vars.put("initiatorName", inst.getInitiatorName());
        putScalarVars(vars, data);

        ProcessInstance pi = startEngine(inst.getDefCode(), vars);
        String newPid = pi.getId();
        // 定位到唤醒节点（若首个等待节点非目标）
        try {
            List<String> active = runtimeService.createExecutionQuery().processInstanceId(newPid).list()
                    .stream().map(Execution::getActivityId).filter(Objects::nonNull).distinct().toList();
            if (!active.isEmpty() && !active.contains(req.nodeId())) {
                runtimeService.createChangeActivityStateBuilder().processInstanceId(newPid)
                        .moveActivityIdsToSingleActivityId(active, req.nodeId())
                        .changeState();
            }
        } catch (Exception e) {
            runtimeService.deleteProcessInstance(newPid, "唤醒定位失败回滚");
            throw new BusinessException(400, "唤醒定位到节点失败：" + e.getMessage());
        }

        String old = inst.getProcInstId();
        inst.setResurrectFrom(old);
        inst.setProcInstId(newPid);
        inst.setEndedAt(null);
        inst.setBizStatus(runtimeEnded(newPid) ? WfInstanceExt.STATUS_APPROVED : WfInstanceExt.STATUS_RUNNING);
        instanceRepository.save(inst);
        operation(newPid, null, req.nodeId(), "唤醒", ctx, WfOperation.ACTION_RESURRECT, req.comment());
        if (inst.getInitiatorId() != null) {
            audit.notify(inst.getInitiatorId(), WfNotify.TYPE_RESULT, "流程被唤醒重审：" + inst.getTitle(),
                    "您的流程「" + inst.getTitle() + "」已被唤醒并定位到节点重新审批", newPid);
        }
        return buildDetail(inst);
    }

    /* ---------------- 抄送 ---------------- */

    public PageResult<CcItem> cc(int pageNum, int pageSize) {
        Long uid = WfSupport.currentUser().getUserId();
        Page<WfCc> page = ccRepository.findByUserId(uid,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        List<CcItem> list = page.getContent().stream().map(cc -> {
            WfInstanceExt inst = instanceRepository.findByProcInstId(cc.getProcInstId()).orElse(null);
            return new CcItem(cc.getId(), cc.getProcInstId(),
                    inst != null ? inst.getTitle() : null,
                    inst != null ? inst.getDefName() : null,
                    inst != null ? inst.getInitiatorName() : null,
                    inst != null ? inst.getBizStatus() : null,
                    cc.getReadFlag(), cc.getCreatedAt());
        }).toList();
        return new PageResult<>(list, page.getTotalElements(), pageNum, pageSize);
    }

    private void markCcRead(String procInstId, Long userId) {
        List<WfCc> rows = ccRepository.findByProcInstIdAndUserId(procInstId, userId);
        boolean changed = false;
        for (WfCc cc : rows) {
            if (!Boolean.TRUE.equals(cc.getReadFlag())) {
                cc.setReadFlag(true);
                changed = true;
            }
        }
        if (changed) {
            ccRepository.saveAll(rows);
        }
    }

    /* ---------------- helpers ---------------- */

    private boolean runtimeEnded(String pid) {
        return runtimeService.createProcessInstanceQuery().processInstanceId(pid).count() == 0;
    }

    /**
     * 发起/重提后流程已同步结束时的落库状态：默认 APPROVED；
     * 若结束前经过「自动拒绝」节点（已写 AUTO_REJECT 操作，实例行此时可能尚未落库无法自置状态），
     * 则修正为 REJECTED，避免自动拒绝被误记为通过。
     */
    private String endedStatus(String pid) {
        boolean autoRejected = operationRepository.findByProcInstIdOrderByCreatedAtAsc(pid).stream()
                .anyMatch(o -> WfOperation.ACTION_AUTO_REJECT.equals(o.getAction()));
        return autoRejected ? WfInstanceExt.STATUS_REJECTED : WfInstanceExt.STATUS_APPROVED;
    }

    private String processBpmn(String defCode) {
        return processRepository.findByDefCode(defCode).map(WfProcessExt::getBpmnXml).orElse(null);
    }

    /**
     * flowConfig.operations 开关：读流程定义 operations.&lt;opKey&gt;（cancel/terminate/retrieve/urge...）；
     * 缺省/缺失 = 允许（true），仅显式 false 关闭。
     */
    private boolean operationEnabled(WfProcessExt def, String opKey) {
        JsonNode fc = flowConfigOf(def);
        if (fc == null) {
            return true;
        }
        JsonNode op = fc.path("operations").path(opKey);
        if (op == null || op.isMissingNode() || op.isNull()) {
            return true;
        }
        return op.asBoolean(true);
    }

    /** 按 defCode 校验流程级操作开关，关闭则 403。 */
    private void requireOperationEnabled(String defCode, String opKey) {
        WfProcessExt def = processRepository.findByDefCode(defCode).orElse(null);
        if (def != null && !operationEnabled(def, opKey)) {
            throw new BusinessException(403, "该流程已关闭「" + opKey + "」操作");
        }
    }

    /**
     * 启动引擎实例，并把审批人求值等阶段抛出的 BusinessException（如 emptyStrategy=BLOCK 阻塞）
     * 从 Flowable 的 FlowableException 包装中解出，避免降级为无语义的 500。
     */
    private ProcessInstance startEngine(String defCode, Map<String, Object> vars) {
        try {
            return runtimeService.startProcessInstanceByKey(defCode, vars);
        } catch (RuntimeException e) {
            Throwable t = e;
            while (t != null) {
                if (t instanceof BusinessException be) {
                    throw be;
                }
                t = t.getCause();
            }
            throw e;
        }
    }

    /** 取流程级 flowConfig：优先 wf_process_ext.flow_config 列，回退 designerJson.flowConfig。 */
    private JsonNode flowConfigOf(WfProcessExt def) {
        try {
            if (StringUtils.hasText(def.getFlowConfig())) {
                return objectMapper.readTree(def.getFlowConfig());
            }
            if (StringUtils.hasText(def.getDesignerJson())) {
                JsonNode fc = objectMapper.readTree(def.getDesignerJson()).path("flowConfig");
                if (fc != null && !fc.isMissingNode() && !fc.isNull()) {
                    return fc;
                }
            }
        } catch (Exception e) {
            log.warn("解析 flowConfig 失败 defCode={}: {}", def.getDefCode(), e.getMessage());
        }
        return null;
    }

    /** flowConfig.variables=[{name,type,defaultValue}] → 注入流程变量（不覆盖已有/表单同名值）。 */
    private void injectFlowVariables(Map<String, Object> vars, JsonNode flowConfig) {
        if (flowConfig == null) {
            return;
        }
        JsonNode variables = flowConfig.path("variables");
        if (!variables.isArray()) {
            return;
        }
        for (JsonNode v : variables) {
            String name = v.path("name").asString(null);
            if (name == null || name.isBlank() || vars.containsKey(name)) {
                continue;
            }
            vars.put(name, coerceVar(v.path("type").asString("string"), v.path("defaultValue")));
        }
    }

    private Object coerceVar(String type, JsonNode value) {
        if (value == null || value.isMissingNode() || value.isNull()) {
            return null;
        }
        return switch (type == null ? "string" : type.toLowerCase()) {
            case "number", "int", "long", "double" -> {
                if (value.isIntegralNumber()) {
                    yield value.asLong();
                }
                if (value.isNumber()) {
                    yield value.asDouble();
                }
                yield parseNumber(value.asString(""));
            }
            case "boolean", "bool" -> value.isBoolean() ? value.asBoolean()
                    : Boolean.parseBoolean(value.asString("false"));
            default -> value.isValueNode() ? value.asString("") : value.toString();
        };
    }

    private Object parseNumber(String s) {
        try {
            return s.contains(".") ? Double.parseDouble(s) : Long.parseLong(s);
        } catch (Exception e) {
            return 0;
        }
    }

    /**
     * taskTitle fx 模板插值：支持 {@code ${field}} 与 {@code {field}} 两种占位；
     * 上下文 = 表单字段 + 内置(initiatorName、别名"申请人")。未匹配占位替换为空串。
     */
    private String interpolateTitle(String tpl, Map<String, Object> formData, String initiatorName) {
        Map<String, Object> ctx = new LinkedHashMap<>(formData);
        ctx.put("initiatorName", initiatorName);
        ctx.put("申请人", initiatorName);
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\\$?\\{\\s*([^}\\s]+?)\\s*}").matcher(tpl);
        // 手动逐段重建（不用 appendReplacement/quoteReplacement）：替换文本中的 $ / \ 不再被当作组引用/转义，
        // 中文 literal + 多占位边界下拼接稳定，字段名去空白后取值。
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            sb.append(tpl, last, m.start());
            Object val = ctx.get(m.group(1).trim());
            sb.append(val == null ? "" : String.valueOf(val));
            last = m.end();
        }
        sb.append(tpl, last, tpl.length());
        return sb.toString();
    }

    private void putScalarVars(Map<String, Object> vars, Map<String, Object> formData) {
        formData.forEach((k, v) -> {
            if (v == null || v instanceof Number || v instanceof String || v instanceof Boolean) {
                vars.put(k, v);
            }
        });
    }

    private void operation(String pid, String taskId, String nodeId, String nodeName,
                           UserContext ctx, String action, String comment) {
        operation(pid, taskId, nodeId, nodeName, ctx, action, comment, null);
    }

    private void operation(String pid, String taskId, String nodeId, String nodeName,
                           UserContext ctx, String action, String comment, OffsetDateTime bizTime) {
        WfOperation op = new WfOperation();
        op.setProcInstId(pid);
        op.setTaskId(taskId);
        op.setNodeId(nodeId);
        op.setNodeName(nodeName);
        op.setActorId(ctx.getUserId());
        op.setActorName(WfSupport.displayName(ctx));
        op.setAction(action);
        op.setComment(comment);
        op.setBizTime(bizTime);
        operationRepository.save(op);
    }

    /** 解析穿越时空业务时间：接受 ISO 日期(yyyy-MM-dd)或带时区的 ISO 日期时间；无效返回 null。 */
    private OffsetDateTime parseBizTime(String raw) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        try {
            if (raw.length() <= 10) { // 纯日期，按当天 00:00 系统时区
                return java.time.LocalDate.parse(raw).atStartOfDay(java.time.ZoneId.systemDefault())
                        .toOffsetDateTime();
            }
            return OffsetDateTime.parse(raw);
        } catch (Exception e) {
            try {
                return java.time.LocalDateTime.parse(raw)
                        .atZone(java.time.ZoneId.systemDefault()).toOffsetDateTime();
            } catch (Exception ex) {
                log.warn("解析 bizTime 失败: {}", raw);
                return null;
            }
        }
    }

    private String toJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            return "{}";
        }
    }

    private Object parseJson(String json) {
        if (!StringUtils.hasText(json)) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (Exception e) {
            return Map.of();
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseMap(String json) {
        Object o = parseJson(json);
        return o instanceof Map ? (Map<String, Object>) o : Map.of();
    }
}
