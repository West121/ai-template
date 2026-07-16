package com.hentor.oa.workflow.service;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.workflow.dto.OrgRef;
import com.hentor.oa.workflow.dto.P2Requests.AssistRequest;
import com.hentor.oa.workflow.dto.P2Requests.CommunicateRequest;
import com.hentor.oa.workflow.engine.AssigneeResolver;
import com.hentor.oa.workflow.entity.WfNotify;
import com.hentor.oa.workflow.entity.WfOperation;
import com.hentor.oa.workflow.entity.WfTaskRead;
import com.hentor.oa.workflow.repository.WfInstanceExtRepository;
import com.hentor.oa.workflow.repository.WfTaskReadRepository;
import com.hentor.oa.workflow.support.WfAudit;
import com.hentor.oa.workflow.support.WfSupport;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 协作类任务操作：协办(assist)/沟通(communicate)/已阅(read)/认领(claim-unclaim)/追加节点(append-node)。
 * 协办与追加节点用独立 ad-hoc 任务承接，不参与主流程完成条件；意见/记录汇入 wf_operation 时间线。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WfCollaborationService {

    static final String VAR_ADHOC_PID = "wfAdhocProcInstId";
    static final String VAR_ADHOC_TYPE = "wfAdhocType";

    private final TaskService taskService;
    private final RepositoryService repositoryService;
    private final WfInstanceExtRepository instanceRepository;
    private final WfTaskReadRepository taskReadRepository;
    private final AssigneeResolver assigneeResolver;
    private final WfAudit audit;
    private final ObjectMapper objectMapper;

    /* ---------------- 协办 / 征求意见 ---------------- */

    @Transactional
    public void assist(String taskId, AssistRequest req) {
        UserContext ctx = WfSupport.currentUser();
        Task main = activeTask(taskId);
        requireAllowedOp(main, "assist");
        List<Long> users = resolveUsers(req.users());
        if (users.isEmpty()) {
            throw new BusinessException(400, "协办人不能为空");
        }
        String pid = main.getProcessInstanceId();
        for (Long uid : users) {
            createAdhoc(pid, uid, "协办：" + main.getName(), "ASSIST");
            audit.notify(uid, WfNotify.TYPE_TODO, "协办邀请：" + main.getName(),
                    WfSupport.displayName(ctx) + " 邀请您协办「" + main.getName() + "」：" + safe(req.comment()), pid);
        }
        audit.op(pid, taskId, main.getTaskDefinitionKey(), main.getName(), ctx,
                WfOperation.ACTION_ASSIST, req.comment(), Map.of("users", users));
    }

    /** ad-hoc 任务（协办/追加节点）办理：记录意见并完成，不影响主流程。 */
    @Transactional
    public void completeAdhoc(String taskId, String comment) {
        UserContext ctx = WfSupport.currentUser();
        Task task = activeTask(taskId);
        if (!Objects.equals(task.getAssignee(), String.valueOf(ctx.getUserId()))) {
            throw new BusinessException(403, "非当前办理人");
        }
        String pid = (String) taskService.getVariable(taskId, VAR_ADHOC_PID);
        String type = (String) taskService.getVariable(taskId, VAR_ADHOC_TYPE);
        String action = "APPEND".equals(type) ? WfOperation.ACTION_APPEND_NODE : WfOperation.ACTION_ASSIST_REPLY;
        audit.op(pid != null ? pid : "-", taskId, null, task.getName(), ctx, action, comment);
        if (pid != null) {
            audit.notify(instanceInitiator(pid), WfNotify.TYPE_RESULT, "协办/追加已办理：" + task.getName(),
                    WfSupport.displayName(ctx) + " 已办理「" + task.getName() + "」", pid);
        }
        taskService.complete(taskId);
    }

    /* ---------------- 沟通留言 ---------------- */

    @Transactional
    public void communicate(String taskId, CommunicateRequest req) {
        UserContext ctx = WfSupport.currentUser();
        Task task = activeTask(taskId);
        String pid = task.getProcessInstanceId();
        audit.op(pid, taskId, task.getTaskDefinitionKey(), task.getName(), ctx,
                WfOperation.ACTION_COMMUNICATE, req.content(),
                req.toUserIds() != null ? Map.of("to", req.toUserIds()) : null);
        if (req.toUserIds() != null) {
            for (Long uid : req.toUserIds()) {
                audit.notify(uid, WfNotify.TYPE_TODO, "流程沟通：" + task.getName(),
                        WfSupport.displayName(ctx) + "：" + req.content(), pid);
            }
        }
    }

    /* ---------------- 已阅 ---------------- */

    @Transactional
    public void read(String taskId) {
        UserContext ctx = WfSupport.currentUser();
        if (taskReadRepository.existsByTaskIdAndUserId(taskId, ctx.getUserId())) {
            return;
        }
        Task task = taskService.createTaskQuery().taskId(taskId).singleResult();
        WfTaskRead r = new WfTaskRead();
        r.setTaskId(taskId);
        r.setProcInstId(task != null ? task.getProcessInstanceId() : null);
        r.setUserId(ctx.getUserId());
        taskReadRepository.save(r);
        if (task != null) {
            audit.op(task.getProcessInstanceId(), taskId, task.getTaskDefinitionKey(), task.getName(), ctx,
                    WfOperation.ACTION_READ, null);
        }
    }

    /* ---------------- 认领 / 退回池 ---------------- */

    @Transactional
    public void claim(String taskId) {
        UserContext ctx = WfSupport.currentUser();
        Task task = activeTask(taskId);
        if (StringUtils.hasText(task.getAssignee())) {
            throw new BusinessException(400, "任务已被认领");
        }
        taskService.claim(taskId, String.valueOf(ctx.getUserId()));
        audit.op(task.getProcessInstanceId(), taskId, task.getTaskDefinitionKey(), task.getName(), ctx,
                WfOperation.ACTION_CLAIM, null);
    }

    @Transactional
    public void unclaim(String taskId) {
        UserContext ctx = WfSupport.currentUser();
        Task task = activeTask(taskId);
        if (!Objects.equals(task.getAssignee(), String.valueOf(ctx.getUserId()))) {
            throw new BusinessException(403, "只能退回本人已认领的任务");
        }
        taskService.unclaim(taskId);
        audit.op(task.getProcessInstanceId(), taskId, task.getTaskDefinitionKey(), task.getName(), ctx,
                WfOperation.ACTION_UNCLAIM, null);
    }

    /* ---------------- 追加节点（实例级动态加处理人） ---------------- */

    @Transactional
    public void appendNode(String pid, String name, List<OrgRef> assignees) {
        UserContext ctx = WfSupport.currentUser();
        List<Long> users = resolveUsers(assignees);
        if (users.isEmpty()) {
            throw new BusinessException(400, "追加节点处理人不能为空");
        }
        String nodeName = StringUtils.hasText(name) ? name : "追加处理";
        for (Long uid : users) {
            createAdhoc(pid, uid, nodeName, "APPEND");
            audit.notify(uid, WfNotify.TYPE_TODO, "追加处理：" + nodeName,
                    WfSupport.displayName(ctx) + " 为流程追加了处理任务「" + nodeName + "」", pid);
        }
        audit.op(pid, null, null, nodeName, ctx, WfOperation.ACTION_APPEND_NODE, null, Map.of("users", users));
    }

    /* ---------------- 动态构建 ad-hoc 任务（P3，不体现在流程图） ---------------- */

    /**
     * 动态构建：按当前实例创建服务层管理的 ad-hoc 任务（不改流程定义、不进流程图）。
     * 与「追加节点」同为 taskService.newTask ad-hoc 机制；完成条件由服务层管理（complete-adhoc 汇入时间线），
     * 不参与主流程完成条件，主流程不因其阻塞。
     */
    @Transactional
    public void adhocTask(String pid, String name, List<OrgRef> assignees) {
        UserContext ctx = WfSupport.currentUser();
        List<Long> users = resolveUsers(assignees);
        if (users.isEmpty()) {
            throw new BusinessException(400, "ad-hoc 任务处理人不能为空");
        }
        String taskName = StringUtils.hasText(name) ? name : "动态任务";
        for (Long uid : users) {
            createAdhoc(pid, uid, taskName, "ADHOC");
            audit.notify(uid, WfNotify.TYPE_TODO, "动态任务：" + taskName,
                    WfSupport.displayName(ctx) + " 为流程动态创建了任务「" + taskName + "」", pid);
        }
        audit.op(pid, null, null, taskName, ctx, WfOperation.ACTION_APPEND_NODE, null, Map.of("users", users, "adhoc", true));
    }

    /* ---------------- helpers ---------------- */

    private void createAdhoc(String pid, Long uid, String name, String type) {
        Task t = taskService.newTask();
        t.setName(name);
        t.setAssignee(String.valueOf(uid));
        taskService.saveTask(t);
        taskService.setVariableLocal(t.getId(), VAR_ADHOC_PID, pid);
        taskService.setVariableLocal(t.getId(), VAR_ADHOC_TYPE, type);
    }

    private Task activeTask(String taskId) {
        Task t = taskService.createTaskQuery().taskId(taskId).active().singleResult();
        if (t == null) {
            throw new BusinessException(404, "任务不存在或已处理");
        }
        return t;
    }

    private Long instanceInitiator(String pid) {
        return instanceRepository.findByProcInstId(pid).map(i -> i.getInitiatorId()).orElse(null);
    }

    private List<Long> resolveUsers(List<OrgRef> refs) {
        if (refs == null || refs.isEmpty()) {
            throw new BusinessException(400, "请选择处理人");
        }
        return assigneeResolver.resolveRefsStrict(objectMapper.valueToTree(refs));
    }

    private String safe(String s) {
        return s == null ? "" : s;
    }

    /** allowedOps 服务端强制：节点 oa:allowedOps 白名单外的操作 403（无配置=全放行）。 */
    private void requireAllowedOp(Task task, String op) {
        try {
            FlowElement fe = repositoryService.getBpmnModel(task.getProcessDefinitionId())
                    .getMainProcess().getFlowElement(task.getTaskDefinitionKey(), true);
            if (fe == null || fe.getExtensionElements() == null) {
                return;
            }
            List<ExtensionElement> list = fe.getExtensionElements().get("allowedOps");
            if (list == null || list.isEmpty() || !StringUtils.hasText(list.get(0).getElementText())) {
                return;
            }
            var node = objectMapper.readTree(list.get(0).getElementText());
            if (node.isArray()) {
                List<String> ops = new java.util.ArrayList<>();
                node.forEach(n -> ops.add(n.asString("")));
                if (!ops.contains(op)) {
                    throw new BusinessException(403, "当前节点不允许「" + op + "」操作");
                }
            }
        } catch (BusinessException be) {
            throw be;
        } catch (Exception e) {
            log.warn("读取节点 allowedOps 失败 node={}: {}", task.getTaskDefinitionKey(), e.getMessage());
        }
    }
}
