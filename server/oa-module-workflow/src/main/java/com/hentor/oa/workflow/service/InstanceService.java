package com.hentor.oa.workflow.service;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.workflow.dto.CcItem;
import com.hentor.oa.workflow.dto.DoneByMeItem;
import com.hentor.oa.workflow.dto.InstanceDetailResponse;
import com.hentor.oa.workflow.dto.InstanceDetailResponse.AssigneeInfo;
import com.hentor.oa.workflow.dto.InstanceDetailResponse.CommentItem;
import com.hentor.oa.workflow.dto.InstanceDetailResponse.CurrentNode;
import com.hentor.oa.workflow.dto.InstanceDetailResponse.Highlight;
import com.hentor.oa.workflow.dto.InstanceDetailResponse.JumpTarget;
import com.hentor.oa.workflow.dto.InstanceDetailResponse.SubInstance;
import com.hentor.oa.workflow.dto.InstanceDetailResponse.TimelineItem;
import com.hentor.oa.workflow.dto.InstanceListItem;
import com.hentor.oa.workflow.dto.P2Requests.CommentRequest;
import com.hentor.oa.workflow.dto.P2Requests.DraftRequest;
import com.hentor.oa.workflow.dto.P2Requests.HandoverRequest;
import com.hentor.oa.workflow.dto.P2Requests.JumpRequest;
import com.hentor.oa.workflow.dto.P3Requests.PredictResponse;
import com.hentor.oa.workflow.dto.P3Requests.PredictResponse.AssigneeName;
import com.hentor.oa.workflow.dto.P3Requests.PredictResponse.PredictNode;
import com.hentor.oa.workflow.dto.P3Requests.PredictResponse.RejectTarget;
import com.hentor.oa.workflow.dto.P3Requests.ResurrectPreview;
import com.hentor.oa.workflow.dto.P3Requests.ResurrectPreview.AssigneeRef;
import com.hentor.oa.workflow.dto.P3Requests.ResurrectRequest;
import com.hentor.oa.workflow.engine.AssigneeResolver;
import com.hentor.oa.workflow.convert.ConditionEvaluator;
import com.hentor.oa.workflow.dto.StartInstanceRequest;
import com.hentor.oa.workflow.dto.StartableItem;
import com.hentor.oa.workflow.entity.WfNotify;
import com.hentor.oa.workflow.support.WfAudit;
import com.hentor.oa.workflow.entity.WfCc;
import com.hentor.oa.workflow.entity.WfFormDef;
import com.hentor.oa.workflow.entity.WfInstanceExt;
import com.hentor.oa.workflow.entity.WfOperation;
import com.hentor.oa.workflow.entity.WfProcessExt;
import com.hentor.oa.workflow.repository.WfCcRepository;
import com.hentor.oa.workflow.repository.WfFormDefRepository;
import com.hentor.oa.workflow.repository.WfInstanceExtRepository;
import com.hentor.oa.workflow.repository.WfOperationRepository;
import com.hentor.oa.workflow.repository.WfProcessExtRepository;
import com.hentor.oa.workflow.repository.WfTaskReadRepository;
import com.hentor.oa.workflow.support.DesignerJsonEnricher;
import com.hentor.oa.workflow.support.UserNameResolver;
import com.hentor.oa.workflow.support.WfSupport;
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
import org.flowable.task.api.history.HistoricTaskInstance;
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
    private final DesignerJsonEnricher designerJsonEnricher;
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
                        WfProcessExt.canonicalFormType(p.getFormType()), p.getFormSubmitPath(), p.getFormViewPath()))
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

        // B-10：若首节点是 webhook/trigger，引擎启动时会同步驱动其 delegate，
        // 而此刻 wf_instance_ext 尚未落库（proc_inst_id 由 startEngine 生成，无法先存）。
        // 因此把标题/定义编码作为流程变量注入，供 delegate 在 ext 未就绪时兜底取用。
        // 使用 wf 前缀命名，避免与表单字段（条件网关求值）撞名。
        vars.put("wfInstanceTitle", title);
        vars.put("wfDefCode", def.getDefCode());

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

    public PageResult<InstanceListItem> my(String keyword, int pageNum, int pageSize) {
        Long uid = WfSupport.currentUser().getUserId();
        String kw = StringUtils.hasText(keyword) ? keyword.trim() : null;
        Page<WfInstanceExt> page = instanceRepository.searchByInitiator(uid, kw,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        return new PageResult<>(page.getContent().stream().map(InstanceListItem::of).toList(),
                page.getTotalElements(), pageNum, pageSize);
    }

    /**
     * 「已办」列表（GET /api/wf/instances/done-by-me）：我办结的历史任务。
     * 组装原则：wf_instance_ext 有行用行；<b>缺行回退 Flowable 历史数据</b>（defName/title 从
     * HistoricProcessInstance 取）——绝不因单条缺行 404 整个列表（orElseThrow 只留给单实例详情语义）。
     * action/comment 从 wf_operation 按任务批量回填（公文经 office 办理无审计行 → null）；
     * viewPath 按流程定义 form_view_path 模板解析（如公文 /document/send/{docId}）。
     */
    public PageResult<DoneByMeItem> doneByMe(String keyword, int pageNum, int pageSize) {
        String uid = String.valueOf(WfSupport.currentUser().getUserId());
        boolean hasKw = StringUtils.hasText(keyword);
        long total = historyService.createHistoricTaskInstanceQuery().taskAssignee(uid).finished().count();
        // keyword 模式：标题/流程名组装后才可比，取前 500 条内存过滤再分页
        List<HistoricTaskInstance> tasks = historyService.createHistoricTaskInstanceQuery()
                .taskAssignee(uid).finished()
                .orderByHistoricTaskInstanceEndTime().desc()
                .listPage(hasKw ? 0 : Math.max(pageNum - 1, 0) * pageSize, hasKw ? 500 : pageSize);

        // 一页一查：任务操作记录（action/comment，取每任务最新一条）
        Map<String, WfOperation> opByTask = new LinkedHashMap<>();
        try {
            List<String> taskIds = tasks.stream().map(HistoricTaskInstance::getId).toList();
            if (!taskIds.isEmpty()) {
                for (WfOperation op : operationRepository.findByTaskIdIn(taskIds)) {
                    WfOperation prev = opByTask.get(op.getTaskId());
                    if (prev == null || (op.getCreatedAt() != null && prev.getCreatedAt() != null
                            && op.getCreatedAt().isAfter(prev.getCreatedAt()))) {
                        opByTask.put(op.getTaskId(), op);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("已办列表操作记录批查失败（action/comment 置空）: {}", e.getMessage());
        }

        // 方法内缓存：历史实例 / 流程定义 view 模板，避免同实例重复查
        Map<String, HistoricProcessInstance> hpiCache = new LinkedHashMap<>();
        Map<String, String> viewTplCache = new LinkedHashMap<>();

        List<DoneByMeItem> list = tasks.stream().map(t -> {
            String pid = t.getProcessInstanceId();
            WfInstanceExt inst = instanceRepository.findByProcInstId(pid).orElse(null);
            Long instanceId = inst != null ? inst.getId() : null;
            String title = inst != null ? inst.getTitle() : null;
            String defName = inst != null ? inst.getDefName() : null;
            String bizStatus = inst != null ? inst.getBizStatus() : null;
            if (inst == null) {
                // 缺行回退：Flowable 历史实例（如遗留直起/被清理过的实例），失败置空不炸列表
                HistoricProcessInstance hpi = hpiCache.computeIfAbsent(pid, this::historicInstanceSafe);
                if (hpi != null) {
                    title = StringUtils.hasText(hpi.getName()) ? hpi.getName() : null;
                    defName = hpi.getProcessDefinitionName();
                    bizStatus = hpi.getEndTime() == null
                            ? WfInstanceExt.STATUS_RUNNING : WfInstanceExt.STATUS_APPROVED;
                }
            }
            String defKey = t.getProcessDefinitionId() != null && t.getProcessDefinitionId().contains(":")
                    ? t.getProcessDefinitionId().substring(0, t.getProcessDefinitionId().indexOf(':'))
                    : t.getProcessDefinitionId();
            String tpl = defKey == null ? null : viewTplCache.computeIfAbsent(defKey,
                    k -> processRepository.findByDefCode(k).map(WfProcessExt::getFormViewPath).orElse(""));
            String viewPath = StringUtils.hasText(tpl) ? resolveViewPath(tpl, pid) : null;

            WfOperation op = opByTask.get(t.getId());
            OffsetDateTime doneAt = t.getEndTime() != null
                    ? t.getEndTime().toInstant().atZone(java.time.ZoneId.systemDefault()).toOffsetDateTime() : null;
            return new DoneByMeItem(t.getId(), pid, instanceId, title, defName, t.getName(),
                    op != null ? op.getAction() : null, op != null ? op.getComment() : null,
                    bizStatus, doneAt, viewPath);
        }).toList();
        if (hasKw) {
            String kw = keyword.trim();
            List<DoneByMeItem> filtered = list.stream()
                    .filter(d -> containsKw(d.instanceTitle(), kw) || containsKw(d.defName(), kw)
                            || containsKw(d.nodeName(), kw))
                    .toList();
            int from = Math.min(Math.max(pageNum - 1, 0) * pageSize, filtered.size());
            int to = Math.min(from + pageSize, filtered.size());
            return new PageResult<>(filtered.subList(from, to), filtered.size(), pageNum, pageSize);
        }
        return new PageResult<>(list, total, pageNum, pageSize);
    }

    private HistoricProcessInstance historicInstanceSafe(String pid) {
        try {
            return historyService.createHistoricProcessInstanceQuery().processInstanceId(pid).singleResult();
        } catch (Exception e) {
            return null;
        }
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
        // 术语归一：DYNAMIC→ONLINE、CUSTOM→CODE（兼容读旧值）
        String formType = WfProcessExt.canonicalFormType(def != null ? def.getFormType() : null);
        // form_view_path 支持 {id} 模板（=businessKey 末段，如公文 GW:67 → 67）：详情返回已解析路径
        String formViewPath = resolveViewPath(def != null ? def.getFormViewPath() : null, pid);

        // 跟踪图分流：DINGTALK 定义额外回传 designerJson（钉钉模型），前端据 designerType 选钉钉跟踪图 / bpmn 图
        String designerType = def != null && StringUtils.hasText(def.getDesignerType())
                ? def.getDesignerType() : WfProcessExt.TYPE_DINGTALK;
        // 返回时动态给办理人规则 refs（USER/DEPT/ROLE/POST）补 name，避免前端跟踪图退化占位「成员#N」；不改存储。
        Object designerJson = def != null && WfProcessExt.TYPE_DINGTALK.equals(designerType)
                && StringUtils.hasText(def.getDesignerJson())
                ? designerJsonEnricher.enrich(def.getDesignerJson()) : null;

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

    public PageResult<InstanceListItem> drafts(String keyword, int pageNum, int pageSize) {
        Long uid = WfSupport.currentUser().getUserId();
        String kw = StringUtils.hasText(keyword) ? keyword.trim() : null;
        Page<WfInstanceExt> page = instanceRepository.searchByInitiatorAndStatus(uid,
                WfInstanceExt.STATUS_DRAFT, kw,
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
        // 静态预测支持 DINGTALK（nodes 树）与 GRAPH（nodes/edges 图）两种设计器，功能对等；
        // 仅 BPMN 专业模式（无 designerJson 归一模型）不支持。
        boolean predictable = StringUtils.hasText(def.getDesignerJson())
                && (WfProcessExt.TYPE_DINGTALK.equals(def.getDesignerType())
                    || WfProcessExt.TYPE_GRAPH.equals(def.getDesignerType()));
        if (!predictable) {
            return new PredictResponse(List.of(), "该流程为 BPMN 专业模式，暂不支持静态预测");
        }
        String pid = inst.getProcInstId();
        boolean ended;
        try {
            ended = runtimeEnded(pid);
        } catch (Exception e) {
            ended = true;
        }
        // 求值上下文：表单快照 + 运行时流程变量（审批可能已改表单）
        Map<String, Object> values = new LinkedHashMap<>(parseMap(inst.getFormDataJson()));
        if (!ended) {
            try {
                runtimeService.getVariables(pid).forEach((k, v) -> {
                    if (v instanceof Number || v instanceof String || v instanceof Boolean) {
                        values.put(k, v);
                    }
                });
            } catch (Exception ignored) {
                // 变量读取失败退化为仅表单值
            }
        }
        // 完整链路：已完成节点(done) + 当前活动节点(current)，其余 future。活动 id == designer 节点 id。
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
            if (!ended) {
                for (Execution ex : runtimeService.createExecutionQuery().processInstanceId(pid).list()) {
                    if (ex.getActivityId() != null) {
                        active.add(ex.getActivityId());
                    }
                }
            }
        } catch (Exception ignored) {
            // 历史/运行时读取失败：退化为全 future（仍输出完整链路结构）
        }

        // 驳回策略（用户方案）：流程级 flowConfig.operations.reject 关闭 → 全链不可驳回；
        // flowConfig.rejectStrategy=PREV → 回上一审批节点；否则回发起人（与引擎默认 target=START 一致）。
        JsonNode flowConfig = flowConfigOf(def);
        boolean rejectDisabled = !operationEnabled(def, "reject");
        boolean rejectToPrev = rejectStrategyPrev(flowConfig);

        List<PredictNode> path = new ArrayList<>();
        try {
            JsonNode root = objectMapper.readTree(def.getDesignerJson());
            PredictState state = new PredictState();
            state.startTarget = startTargetOf(root.path("nodes"), inst); // 回发起人兜底目标
            if (WfProcessExt.TYPE_GRAPH.equals(def.getDesignerType())) {
                predictWalkGraph(root, values, inst, completed, active, path,
                        rejectDisabled, rejectToPrev, state);
            } else {
                predictWalk(root.path("nodes"), values, inst, completed, active, path,
                        rejectDisabled, rejectToPrev, state, null);
            }
        } catch (Exception e) {
            log.warn("流程预测失败 id={}: {}", id, e.getMessage());
        }
        String note;
        if (path.isEmpty()) {
            note = "无可预测节点";
        } else if (ended) {
            note = "流程已结束，展示完整链路";
        } else {
            note = null;
        }
        return new PredictResponse(path, note);
    }

    /** 预测游走状态：驳回目标（回发起人兜底 + 上一审批节点）。 */
    private static final class PredictState {
        private RejectTarget startTarget;
        private RejectTarget lastApproval;
    }

    /**
     * 完整链路 DFS：从流程起点走全程，<b>不跳过已完成节点</b>。
     * completed→done、active→current、其余→future；条件网关走命中分支（正向主链路），
     * 并行网关多路都纳入并标同一 parallelGroup，审批节点标 canReject/rejectTo/multiMode + 全部办理人。
     */
    private void predictWalk(JsonNode nodes, Map<String, Object> values, WfInstanceExt inst,
                             Set<String> completed, Set<String> active, List<PredictNode> path,
                             boolean rejectDisabled, boolean rejectToPrev, PredictState state,
                             String parallelGroup) {
        if (nodes == null || !nodes.isArray()) {
            return;
        }
        for (JsonNode node : nodes) {
            String type = node.path("type").asString("");
            String nid = node.path("id").asString("");
            String nodeName = node.path("name").asString(type);

            // 条件/包容网关：按当前表单值走命中分支（正向主链路）；全不命中走 default 兜底。
            if ("condition".equals(type) || "inclusive".equals(type)) {
                boolean inclusive = "INCLUSIVE".equalsIgnoreCase(node.path("gatewayType").asString("EXCLUSIVE"))
                        || "inclusive".equals(type);
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
                        predictWalk(branch.path("steps"), values, inst, completed, active, path,
                                rejectDisabled, rejectToPrev, state, parallelGroup);
                        if (!inclusive) {
                            break; // 排它：命中首个即止
                        }
                    }
                }
                if (!anyMatched && defaultBranch != null) {
                    predictWalk(defaultBranch.path("steps"), values, inst, completed, active, path,
                            rejectDisabled, rejectToPrev, state, parallelGroup);
                }
                continue;
            }

            // 并行网关：各分支都纳入完整链路，标同一 parallelGroup（同组前端并排）。
            if ("parallel".equals(type)) {
                String group = StringUtils.hasText(nid) ? nid : ("parallel_" + path.size());
                for (JsonNode branch : node.path("branches")) {
                    predictWalk(branch.path("steps"), values, inst, completed, active, path,
                            rejectDisabled, rejectToPrev, state, group);
                }
                continue;
            }

            // 普通节点（approval/cc/start/autoApprove/subprocess/ai/timer/...）：如实纳入链路。
            String status = statusOf(nid, type, completed, active);
            List<AssigneeName> assignees = List.of();
            String multiMode = null;
            boolean canReject = false;
            RejectTarget rejectTo = null;
            if ("approval".equals(type)) {
                List<Long> ids = assigneeResolver.resolveOffline(node.path("assigneeRules"),
                        inst.getInitiatorId(), inst.getInitiatorDeptId(), values);
                assignees = ids.stream()
                        .map(uid -> new AssigneeName(nameResolver.name(uid))).toList();
                multiMode = node.path("multiMode").asString("ANY");
                // 只标可驳回点：流程级未关闭 reject + 节点 allowedOps 未显式排除 reject（缺省 true）。
                canReject = !rejectDisabled && nodeAllowsReject(node);
                if (canReject) {
                    rejectTo = (rejectToPrev && state.lastApproval != null)
                            ? state.lastApproval : state.startTarget; // PREV 无上一审批 → 兜底发起人
                }
            }
            path.add(new PredictNode(nid, nodeName, type, assignees, status, type,
                    canReject, rejectTo, multiMode, parallelGroup));
            if ("approval".equals(type)) {
                state.lastApproval = new RejectTarget(nid, nodeName); // 后续审批节点 PREV 驳回目标
            }
        }
    }

    // ---------------- P3：GRAPH（nodes/edges 图）静态预测，与 DINGTALK 功能对等 ----------------

    /** GRAPH 条件运算符名 → 符号（与 GraphToBpmnConverter OP_SYMBOL 一致），供离线条件求值。 */
    private static final Map<String, String> GRAPH_OP_SYMBOL = Map.of(
            "eq", "==", "ne", "!=", "gt", ">", "gte", ">=", "lt", "<", "lte", "<=");

    /**
     * GRAPH 完整链路：从 startEvent 沿 edges 走全程。网关（exclusive/inclusive/parallel）仅路由、
     * <b>不入 predictChain</b>（无 assigneeName）；userTask 复用 resolveOffline/nameResolver 出预测办理人，
     * 与 DINGTALK 路径功能对等（条件按当前值走命中分支、并签 multiMode、驳回目标、并行分组、抄送节点）。
     */
    private void predictWalkGraph(JsonNode root, Map<String, Object> values, WfInstanceExt inst,
                                  Set<String> completed, Set<String> active, List<PredictNode> path,
                                  boolean rejectDisabled, boolean rejectToPrev, PredictState state) {
        JsonNode nodesArr = root.path("nodes");
        if (!nodesArr.isArray()) {
            return;
        }
        Map<String, JsonNode> nodeById = new LinkedHashMap<>();
        for (JsonNode n : nodesArr) {
            nodeById.put(n.path("id").asString(""), n);
        }
        Map<String, List<JsonNode>> edgesBySource = new LinkedHashMap<>();
        for (JsonNode e : root.path("edges")) {
            edgesBySource.computeIfAbsent(e.path("source").asString(""), k -> new ArrayList<>()).add(e);
        }
        String startId = null;
        for (JsonNode n : nodesArr) {
            String t = n.path("type").asString("");
            if ("startEvent".equals(t) || "start".equals(t)) {
                startId = n.path("id").asString("");
                break;
            }
        }
        if (startId != null) {
            walkGraph(startId, nodeById, edgesBySource, values, inst, completed, active, path,
                    rejectDisabled, rejectToPrev, state, null, new LinkedHashSet<>());
        }
    }

    private void walkGraph(String nodeId, Map<String, JsonNode> nodeById,
                           Map<String, List<JsonNode>> edgesBySource, Map<String, Object> values,
                           WfInstanceExt inst, Set<String> completed, Set<String> active,
                           List<PredictNode> path, boolean rejectDisabled, boolean rejectToPrev,
                           PredictState state, String parallelGroup, Set<String> visited) {
        if (nodeId == null || nodeId.isEmpty() || visited.contains(nodeId)) {
            return;
        }
        JsonNode node = nodeById.get(nodeId);
        if (node == null) {
            return;
        }
        visited.add(nodeId);
        String type = node.path("type").asString("");
        List<JsonNode> outs = edgesBySource.getOrDefault(nodeId, List.of());

        // 排它/包容网关：按当前值走命中出边（跳过网关自身，不入链）
        if ("exclusiveGateway".equals(type) || "inclusiveGateway".equals(type)) {
            boolean inclusive = "inclusiveGateway".equals(type);
            JsonNode defaultEdge = null;
            boolean anyMatched = false;
            for (JsonNode e : outs) {
                if (e.path("isDefault").asBoolean(false)) {
                    defaultEdge = e;
                    continue;
                }
                if (graphEdgeMatches(e.path("condition"), values)) {
                    anyMatched = true;
                    walkGraph(e.path("target").asString(""), nodeById, edgesBySource, values, inst,
                            completed, active, path, rejectDisabled, rejectToPrev, state, parallelGroup, visited);
                    if (!inclusive) {
                        break;
                    }
                }
            }
            if (!anyMatched && defaultEdge != null) {
                walkGraph(defaultEdge.path("target").asString(""), nodeById, edgesBySource, values, inst,
                        completed, active, path, rejectDisabled, rejectToPrev, state, parallelGroup, visited);
            }
            return;
        }
        // 并行网关：fork 各出边同组并排；join 单出边（visited 处理汇聚）
        if ("parallelGateway".equals(type)) {
            String group = outs.size() > 1 ? nodeId : parallelGroup;
            for (JsonNode e : outs) {
                walkGraph(e.path("target").asString(""), nodeById, edgesBySource, values, inst,
                        completed, active, path, rejectDisabled, rejectToPrev, state, group, visited);
            }
            return;
        }
        // endEvent：终点不入链（与 DINGTALK 无显式 end 节点对齐）
        if ("endEvent".equals(type)) {
            return;
        }

        // 普通节点入链（startEvent→start / userTask→approval / cc / 其它透传）
        JsonNode props = node.path("props");
        String semantic = mapGraphType(type);
        String status = statusOf(nodeId, semantic, completed, active);
        List<AssigneeName> assignees = List.of();
        String multiMode = null;
        boolean canReject = false;
        RejectTarget rejectTo = null;
        if ("userTask".equals(type)) {
            List<Long> ids = assigneeResolver.resolveOffline(props.path("assigneeRules"),
                    inst.getInitiatorId(), inst.getInitiatorDeptId(), values);
            assignees = ids.stream().map(uid -> new AssigneeName(nameResolver.name(uid))).toList();
            multiMode = props.path("multiMode").asString("ANY");
            canReject = !rejectDisabled && nodeAllowsReject(props);
            if (canReject) {
                rejectTo = (rejectToPrev && state.lastApproval != null) ? state.lastApproval : state.startTarget;
            }
        }
        String nodeName = node.path("name").asString(semantic);
        path.add(new PredictNode(nodeId, nodeName, semantic, assignees, status, semantic,
                canReject, rejectTo, multiMode, parallelGroup));
        if ("userTask".equals(type)) {
            state.lastApproval = new RejectTarget(nodeId, nodeName);
        }
        for (JsonNode e : outs) {
            walkGraph(e.path("target").asString(""), nodeById, edgesBySource, values, inst,
                    completed, active, path, rejectDisabled, rejectToPrev, state, parallelGroup, visited);
        }
    }

    /** GRAPH 节点类型 → 与 DINGTALK 对齐的语义类型（前端一致渲染）。 */
    private String mapGraphType(String graphType) {
        return switch (graphType) {
            case "startEvent" -> "start";
            case "userTask" -> "approval";
            case "endEvent" -> "end";
            default -> graphType; // cc / autoApprove / ai / timer / subprocess … 透传
        };
    }

    /** GRAPH 出边条件离线求值：{logic, items:[{field,operator,value}]}，运算符名映射符号后交 ConditionEvaluator。 */
    private boolean graphEdgeMatches(JsonNode condition, Map<String, Object> values) {
        if (condition == null || condition.isMissingNode() || condition.isNull()) {
            return true; // 无条件出边恒真
        }
        JsonNode items = condition.path("items");
        if (!items.isArray() || items.isEmpty()) {
            return true;
        }
        var conditions = objectMapper.createArrayNode();
        for (JsonNode item : items) {
            var o = objectMapper.createObjectNode();
            o.put("field", item.path("field").asString(""));
            String op = item.path("operator").asString("");
            o.put("operator", GRAPH_OP_SYMBOL.getOrDefault(op, op));
            JsonNode v = item.get("value");
            if (v != null) {
                o.set("value", v);
            }
            conditions.add(o);
        }
        return ConditionEvaluator.eval(conditions, condition.path("logic").asString("AND"), values);
    }

    /** 链路状态：起点恒 done；活动集合 current；历史完成 done；其余 future。 */
    private String statusOf(String nid, String type, Set<String> completed, Set<String> active) {
        if ("start".equals(type)) {
            return "done"; // 起点一旦发起即已走过
        }
        if (active.contains(nid)) {
            return "current";
        }
        if (completed.contains(nid)) {
            return "done";
        }
        return "future";
    }

    /** 审批节点是否允许驳回：allowedOps 显式白名单则须含 reject；未配置 → 默认 true。 */
    private boolean nodeAllowsReject(JsonNode node) {
        JsonNode ops = node.path("allowedOps");
        if (ops != null && ops.isArray() && ops.size() > 0) {
            for (JsonNode op : ops) {
                if ("reject".equals(op.asString(""))) {
                    return true;
                }
            }
            return false; // 配了白名单但不含 reject → 不可驳回
        }
        return true;
    }

    /** 驳回策略是否「回上一审批节点」：flowConfig.rejectStrategy / operations.rejectTo = PREV。缺省回发起人。 */
    private boolean rejectStrategyPrev(JsonNode flowConfig) {
        if (flowConfig == null) {
            return false;
        }
        String s = flowConfig.path("rejectStrategy").asString(
                flowConfig.path("operations").path("rejectTo").asString(""));
        return "PREV".equalsIgnoreCase(s) || "PREV_NODE".equalsIgnoreCase(s)
                || "上一节点".equals(s) || "上一审批".equals(s) || "上一审批节点".equals(s);
    }

    /** 回发起人的驳回目标：优先图中 start 节点 {id,name}，无则 {"start", 发起人名/"发起人"}。 */
    private RejectTarget startTargetOf(JsonNode rootNodes, WfInstanceExt inst) {
        String sid = "start";
        String sname = null;
        if (rootNodes != null && rootNodes.isArray()) {
            for (JsonNode n : rootNodes) {
                String t = n.path("type").asString("");
                if ("start".equals(t) || "startEvent".equals(t)) { // DINGTALK start / GRAPH startEvent
                    sid = n.path("id").asString("start");
                    sname = n.path("name").asString(null);
                    break;
                }
            }
        }
        if (!StringUtils.hasText(sname)) {
            sname = StringUtils.hasText(inst.getInitiatorName()) ? inst.getInitiatorName() : "发起人";
        }
        return new RejectTarget(sid, sname);
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
        // 重新选人/选角色（可选）：先解析校验（无效人员即 400），再启引擎——失败不残留新实例。
        List<Long> overrideUsers = List.of();
        if (req.assignees() != null && !req.assignees().isEmpty()) {
            overrideUsers = assigneeResolver.resolveRefsStrict(objectMapper.valueToTree(req.assignees()));
            if (overrideUsers.isEmpty()) {
                throw new BusinessException(400, "唤醒指定的办理人解析为空");
            }
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

        // 传了 assignees → 覆盖 nodeId 新任务办理人（复用转办/指派 setAssignee 落地路径）；不传 → 维持规则解析（向后兼容）。
        if (!overrideUsers.isEmpty()) {
            overrideAssignees(newPid, req.nodeId(), overrideUsers, ctx);
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

    /**
     * 唤醒 override：把 nodeId 上刚重建的活动任务办理人覆盖为所选用户（复用转办/指派 setAssignee 路径）。
     * 多任务（并审）× 多选人时按 task i → users[i % n] 分派；单任务取首个。留痕 operation，并通知新办理人。
     */
    private void overrideAssignees(String pid, String nodeId, List<Long> users, UserContext ctx) {
        List<Task> nodeTasks = taskService.createTaskQuery()
                .processInstanceId(pid).taskDefinitionKey(nodeId).active().list();
        if (nodeTasks.isEmpty()) {
            // 节点未生成等待任务（如自动通过），无可覆盖对象——不报错，仅记录规则解析已生效
            return;
        }
        for (int i = 0; i < nodeTasks.size(); i++) {
            Task t = nodeTasks.get(i);
            Long uid = users.get(i % users.size());
            taskService.setAssignee(t.getId(), String.valueOf(uid));
        }
        String names = users.stream().map(nameResolver::name)
                .filter(Objects::nonNull).collect(java.util.stream.Collectors.joining("、"));
        operation(pid, nodeTasks.get(0).getId(), nodeId, nodeTasks.get(0).getName(), ctx,
                WfOperation.ACTION_TRANSFER, "唤醒重新指派办理人：" + names);
        for (Long uid : users) {
            audit.notify(uid, WfNotify.TYPE_TODO, "唤醒待办：" + nodeTasks.get(0).getName(),
                    "流程被唤醒重审，节点「" + nodeTasks.get(0).getName() + "」已指派给您处理", pid);
        }
    }

    /**
     * 唤醒选人预览：返回节点名 + 原实例该节点最后一次办理人（默认回填）+ 节点规则默认解析（兜底）。
     * 权限同唤醒（wf:instance:admin）。
     */
    @Transactional(readOnly = true)
    public ResurrectPreview resurrectPreview(Long id, String nodeId) {
        requireInstanceAdmin();
        if (!StringUtils.hasText(nodeId)) {
            throw new BusinessException(400, "请指定 nodeId");
        }
        WfInstanceExt inst = instanceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "实例不存在"));
        WfProcessExt def = processRepository.findByDefCode(inst.getDefCode()).orElse(null);

        // 历史办理人：原（已结束）实例 procInstId 该 nodeId 最后一轮任务办理人（act_hi_taskinst，多人取全部）
        List<AssigneeRef> history = historyAssignees(inst.getProcInstId(), nodeId);

        // 节点名 + 规则默认解析（DINGTALK 图；BPMN 专业模式无静态图则留空）
        String nodeName = null;
        List<AssigneeRef> rule = new ArrayList<>();
        if (def != null && WfProcessExt.TYPE_DINGTALK.equals(def.getDesignerType())
                && StringUtils.hasText(def.getDesignerJson())) {
            try {
                JsonNode node = findGraphNode(objectMapper.readTree(def.getDesignerJson()).path("nodes"), nodeId);
                if (node != null) {
                    nodeName = node.path("name").asString(null);
                    Map<String, Object> values = new LinkedHashMap<>(parseMap(inst.getFormDataJson()));
                    for (Long uid : assigneeResolver.resolveOffline(node.path("assigneeRules"),
                            inst.getInitiatorId(), inst.getInitiatorDeptId(), values)) {
                        rule.add(new AssigneeRef(uid, nameResolver.name(uid)));
                    }
                }
            } catch (Exception e) {
                log.warn("唤醒预览规则解析失败 id={} nodeId={}: {}", id, nodeId, e.getMessage());
            }
        }
        return new ResurrectPreview(nodeName, history, rule);
    }

    /** 原实例 nodeId 最后一轮（最晚进入时间起）历史任务的办理人，去重保序。 */
    private List<AssigneeRef> historyAssignees(String procInstId, String nodeId) {
        List<AssigneeRef> out = new ArrayList<>();
        if (!StringUtils.hasText(procInstId)) {
            return out;
        }
        List<HistoricTaskInstance> hist = historyService.createHistoricTaskInstanceQuery()
                .processInstanceId(procInstId).taskDefinitionKey(nodeId)
                .orderByHistoricTaskInstanceEndTime().desc().list();
        if (hist.isEmpty()) {
            return out;
        }
        // 最后一轮：以最晚一条任务的进入(start)时间为界，纳入同轮（含并审并行任务），排除更早的驳回轮
        java.util.Date lastStart = hist.stream().map(HistoricTaskInstance::getStartTime)
                .filter(Objects::nonNull).max(java.util.Date::compareTo).orElse(null);
        Set<Long> seen = new LinkedHashSet<>();
        for (HistoricTaskInstance h : hist) {
            if (!StringUtils.hasText(h.getAssignee())) {
                continue;
            }
            if (lastStart != null && h.getStartTime() != null && h.getStartTime().before(lastStart)) {
                continue; // 更早驳回轮的办理人不回填
            }
            try {
                Long uid = Long.parseLong(h.getAssignee().trim());
                if (seen.add(uid)) {
                    out.add(new AssigneeRef(uid, nameResolver.name(uid)));
                }
            } catch (NumberFormatException ignored) {
                // 非数字 assignee（占位/表达式）跳过
            }
        }
        return out;
    }

    /** 在 DINGTALK 图 nodes（含条件分支 steps）中递归查找指定 id 的节点。 */
    private JsonNode findGraphNode(JsonNode nodes, String nodeId) {
        if (nodes == null || !nodes.isArray()) {
            return null;
        }
        for (JsonNode node : nodes) {
            if (nodeId.equals(node.path("id").asString(null))) {
                return node;
            }
            if ("condition".equals(node.path("type").asString(""))) {
                for (JsonNode branch : node.path("branches")) {
                    JsonNode hit = findGraphNode(branch.path("steps"), nodeId);
                    if (hit != null) {
                        return hit;
                    }
                }
            }
        }
        return null;
    }

    /* ---------------- 抄送 ---------------- */

    public PageResult<CcItem> cc(String keyword, int pageNum, int pageSize) {
        Long uid = WfSupport.currentUser().getUserId();
        boolean hasKw = StringUtils.hasText(keyword);
        // keyword 模式：标题/流程名在 wf_instance_ext（组装后才知道），取前 500 条内存过滤再分页
        Page<WfCc> page = ccRepository.findByUserId(uid, hasKw
                ? PageRequest.of(0, 500, Sort.by(Sort.Direction.DESC, "id"))
                : PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        List<CcItem> assembled = page.getContent().stream().map(cc -> {
            WfInstanceExt inst = instanceRepository.findByProcInstId(cc.getProcInstId()).orElse(null);
            return new CcItem(cc.getId(), cc.getProcInstId(),
                    inst != null ? inst.getTitle() : null,
                    inst != null ? inst.getDefName() : null,
                    inst != null ? inst.getInitiatorName() : null,
                    inst != null ? inst.getBizStatus() : null,
                    cc.getReadFlag(), cc.getCreatedAt());
        }).toList();
        if (!hasKw) {
            return new PageResult<>(assembled, page.getTotalElements(), pageNum, pageSize);
        }
        String kw = keyword.trim();
        List<CcItem> filtered = assembled.stream()
                .filter(c -> containsKw(c.title(), kw) || containsKw(c.defName(), kw))
                .toList();
        int from = Math.min(Math.max(pageNum - 1, 0) * pageSize, filtered.size());
        int to = Math.min(from + pageSize, filtered.size());
        return new PageResult<>(filtered.subList(from, to), filtered.size(), pageNum, pageSize);
    }

    private boolean containsKw(String s, String kw) {
        return s != null && s.contains(kw);
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
     * form_view_path 的 {id} 模板解析：{id}=实例 businessKey 末段（如公文 GW:67 → 67）。
     * 无模板/无 {id} 原样返回；有 {id} 但取不到 businessKey → null（前端回退通用实例详情）。
     */
    private String resolveViewPath(String template, String pid) {
        if (!StringUtils.hasText(template) || !template.contains("{id}")) {
            return template;
        }
        String bk = null;
        try {
            ProcessInstance pi = runtimeService.createProcessInstanceQuery().processInstanceId(pid).singleResult();
            bk = pi != null ? pi.getBusinessKey() : null;
            if (bk == null) {
                HistoricProcessInstance hpi = historyService.createHistoricProcessInstanceQuery()
                        .processInstanceId(pid).singleResult();
                bk = hpi != null ? hpi.getBusinessKey() : null;
            }
        } catch (Exception ignored) {
            // businessKey 读取失败按无处理
        }
        if (!StringUtils.hasText(bk)) {
            return null;
        }
        String id = bk.contains(":") ? bk.substring(bk.lastIndexOf(':') + 1) : bk;
        return StringUtils.hasText(id) ? template.replace("{id}", id) : null;
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
