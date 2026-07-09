package com.xingchen.oa.workflow.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.workflow.entity.WfAddSign;
import com.xingchen.oa.workflow.entity.WfNotify;
import com.xingchen.oa.workflow.entity.WfOperation;
import com.xingchen.oa.workflow.repository.WfAddSignRepository;
import com.xingchen.oa.workflow.support.WfAudit;
import com.xingchen.oa.workflow.support.WfSupport;
import jakarta.persistence.OptimisticLockException;
import lombok.RequiredArgsConstructor;
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 加签串行链：单个任务沿链依次流转，不复用节点多实例（避免 ANY 或签退化）。
 * PRE 链=[被加签人..., 原审批人]（B 先审→回 A→A 审→下一节点）；
 * POST 链=[原审批人, 被加签人...]（A 先审→B 审→下一节点）。
 * 审批推进由 {@link WfTaskService#approve} 调 {@link #advance} 整合：非末位=流转下一人(setAssignee，不 complete)；
 * 末位=返回 false 交回调用方真正 complete 推进节点。
 */
@Service
@RequiredArgsConstructor
public class AddSignService {

    private final TaskService taskService;
    private final WfAddSignRepository repository;
    private final WfAudit audit;
    private final ObjectMapper objectMapper;

    /** 建立加签链。users 为已解析且校验存在的用户 id。 */
    @Transactional
    public void create(Task task, UserContext ctx, String mode, List<Long> users, String comment) {
        if (users == null || users.isEmpty()) {
            throw new BusinessException(400, "加签人不能为空");
        }
        if (repository.findByTaskIdAndStatus(task.getId(), WfAddSign.STATUS_RUNNING).isPresent()) {
            throw new BusinessException(400, "该任务已有进行中的加签链，请待其完成");
        }
        boolean post = WfAddSign.MODE_POST.equalsIgnoreCase(mode);
        Long origin = ctx.getUserId();
        List<Long> chain = new ArrayList<>();
        if (post) {
            chain.add(origin);
            chain.addAll(users);
        } else {
            chain.addAll(users);
            chain.add(origin);
        }

        WfAddSign c = new WfAddSign();
        c.setTaskId(task.getId());
        c.setProcInstId(task.getProcessInstanceId());
        c.setNodeId(task.getTaskDefinitionKey());
        c.setOriginUserId(origin);
        c.setMode(post ? WfAddSign.MODE_POST : WfAddSign.MODE_PRE);
        c.setChainJson(toJson(chain));
        c.setPos(0);
        c.setStatus(WfAddSign.STATUS_RUNNING);
        repository.save(c);

        audit.op(task.getProcessInstanceId(), task.getId(), task.getTaskDefinitionKey(), task.getName(), ctx,
                WfOperation.ACTION_ADD_SIGN, comment, Map.of("mode", c.getMode(), "users", users));

        if (!post) {
            // 前加签：把任务转给链首（被加签人先审），原审批人待其审完再拿回
            Long first = chain.get(0);
            taskService.setAssignee(task.getId(), String.valueOf(first));
            audit.notify(first, WfNotify.TYPE_TODO, "前加签待办：" + task.getName(),
                    WfSupport.displayName(ctx) + " 前加签，请您先审「" + task.getName() + "」，审后回到原审批人",
                    task.getProcessInstanceId());
        }
        // 后加签：原审批人保留任务先审，approve 时再流转到被加签人
    }

    /**
     * 审批推进整合：返回 true 表示本次是加签链的中间步（已流转到下一人，调用方勿 complete）；
     * false 表示末位或无链（调用方照常 complete 推进节点）。
     */
    @Transactional
    public boolean advance(Task task, UserContext ctx, Map<String, Object> vars) {
        WfAddSign c = repository.findByTaskIdAndStatus(task.getId(), WfAddSign.STATUS_RUNNING).orElse(null);
        if (c == null) {
            return false;
        }
        List<Long> chain = parse(c.getChainJson());
        int pos = c.getPos();
        if (pos < chain.size() - 1) {
            Long next = chain.get(pos + 1);
            c.setPos(pos + 1);
            // B-07：并发推进同一加签链时，@Version 保证只有一个 saveAndFlush 成功，另一个转 409。
            // 先落库版本再改引擎任务，避免败者已 setAssignee 又回滚造成的引擎/审计不一致。
            saveWithOptimisticLock(c);
            if (vars != null && !vars.isEmpty()) {
                taskService.setVariables(task.getId(), vars); // 保留各审批人对表单的修改
            }
            taskService.setAssignee(task.getId(), String.valueOf(next));
            boolean backToOrigin = next.equals(c.getOriginUserId());
            audit.notify(next, WfNotify.TYPE_TODO, "加签待办：" + task.getName(),
                    backToOrigin ? "前加签人已审完，请您继续审「" + task.getName() + "」"
                            : WfSupport.displayName(ctx) + " 已审，请您继续审「" + task.getName() + "」",
                    task.getProcessInstanceId());
            return true;
        }
        c.setStatus(WfAddSign.STATUS_DONE);
        saveWithOptimisticLock(c);
        return false;
    }

    /**
     * 版本敏感保存（B-07）：加签链并发推进冲突时 Hibernate 抛乐观锁异常，转 409。
     * saveAndFlush 使 UPDATE 立即执行，冲突在此抛出并被捕获（否则将延迟到事务提交、越过 try）。
     */
    private void saveWithOptimisticLock(WfAddSign c) {
        try {
            repository.saveAndFlush(c);
        } catch (OptimisticLockingFailureException | OptimisticLockException e) {
            throw new BusinessException(409, "该任务正被其他人并发处理，请刷新后重试");
        }
    }

    private String toJson(List<Long> ids) {
        try {
            return objectMapper.writeValueAsString(ids);
        } catch (Exception e) {
            throw new BusinessException(500, "加签链序列化失败");
        }
    }

    private List<Long> parse(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<List<Long>>() {
            });
        } catch (Exception e) {
            return List.of();
        }
    }
}
