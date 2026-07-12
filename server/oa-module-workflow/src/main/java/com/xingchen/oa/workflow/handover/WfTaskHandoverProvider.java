package com.xingchen.oa.workflow.handover;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.system.entity.SysHandoverItem;
import com.xingchen.oa.system.handover.HandoverItemProvider;
import com.xingchen.oa.system.handover.HandoverScan;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 待办交接（itemType=WF_TASK）：把离职人名下运行中实例的未办 userTask <b>批量转办</b>给继任者。
 * 幂等：任务已办结/不存在或已在继任者名下 → no-op。运行中实例里指向离职人的节点由此覆盖
 * （未来节点若走 LEADER/角色，则随部门负责人变更/任职失效自动改派，无需逐条重写定义）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WfTaskHandoverProvider implements HandoverItemProvider {

    public static final String TYPE = "WF_TASK";

    private final TaskService taskService;
    private final ObjectMapper objectMapper;

    @Override
    public String itemType() {
        return TYPE;
    }

    @Override
    public List<HandoverScan> scan(Long fromUserId) {
        List<Task> tasks = taskService.createTaskQuery()
                .taskAssignee(String.valueOf(fromUserId))
                .list();
        return tasks.stream().map(t -> {
            Map<String, Object> old = new LinkedHashMap<>();
            old.put("taskId", t.getId());
            old.put("taskName", t.getName());
            old.put("assignee", t.getAssignee());
            old.put("processInstanceId", t.getProcessInstanceId());
            return new HandoverScan("TASK", t.getId(), toJson(old),
                    "待办：" + (t.getName() == null ? t.getId() : t.getName()));
        }).toList();
    }

    @Override
    public void execute(SysHandoverItem item, Long successorId) {
        if (successorId == null) {
            throw new BusinessException(400, "待办交接需指定继任者");
        }
        Task task = taskService.createTaskQuery().taskId(item.getRefId()).singleResult();
        if (task == null) {
            return; // 幂等：任务已办结/不存在
        }
        String successor = String.valueOf(successorId);
        if (successor.equals(task.getAssignee())) {
            return; // 幂等：已在继任者名下
        }
        taskService.setAssignee(item.getRefId(), successor);
    }

    private String toJson(Object v) {
        try {
            return objectMapper.writeValueAsString(v);
        } catch (Exception e) {
            return String.valueOf(v);
        }
    }
}
