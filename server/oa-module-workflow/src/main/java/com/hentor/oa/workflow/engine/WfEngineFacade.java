package com.hentor.oa.workflow.engine;

import lombok.RequiredArgsConstructor;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.history.HistoricActivityInstance;
import org.flowable.engine.runtime.Execution;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.task.api.Task;
import org.flowable.variable.api.history.HistoricVariableInstance;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 引擎门面（业务模块唯一合法引擎入口）：office 等业务模块<b>不得</b> import org.flowable——
 * 起流程/办理任务/查活动与变量一律经本门面（DTO 出入，不泄漏引擎类型）。
 * 架构守护：{@code BusinessModuleEngineImportGuardTest} 扫源码断言 office/system 零 org.flowable 引用。
 *
 * <p>语义与业务模块原直调逐一等价（收口重构行为不变）：
 * start=startProcessInstanceByKey+setProcessInstanceName；firstActiveTask=active 任务按创建时间取首个
 * （多实例会签场景避免 singleResult 抛错）；historicActivities 跳过空 activityId，finished=endTime!=null
 * （对应 unfinished() 查询语义取反）；activeActivityIds=运行时执行的非空 activityId。
 */
@Service
@RequiredArgsConstructor
public class WfEngineFacade {

    private final RuntimeService runtimeService;
    private final TaskService taskService;
    private final HistoryService historyService;

    /** 当前活动任务投影（office 详情/办理用）。 */
    public record ActiveTask(String id, String taskDefinitionKey, String name, String assignee) {
    }

    /** 历史活动投影（流程图高亮/预测用）：finished = endTime != null。 */
    public record ActivityState(String activityId, boolean finished) {
    }

    // ==================== 实例 ====================

    /** 起流程（key+businessKey+vars）并置实例名，返回 procInstId。 */
    public String startProcess(String defCode, String businessKey, String name, Map<String, Object> variables) {
        ProcessInstance pi = runtimeService.startProcessInstanceByKey(defCode, businessKey, variables);
        if (name != null) {
            runtimeService.setProcessInstanceName(pi.getId(), name);
        }
        return pi.getProcessInstanceId();
    }

    public void deleteProcess(String procInstId, String reason) {
        runtimeService.deleteProcessInstance(procInstId, reason);
    }

    /** 运行中实例是否存在（重提前清理判断）。 */
    public boolean processExists(String procInstId) {
        return runtimeService.createProcessInstanceQuery().processInstanceId(procInstId).count() > 0;
    }

    /** 实例是否已结束（无运行时执行）。 */
    public boolean processEnded(String procInstId) {
        return runtimeService.createExecutionQuery().processInstanceId(procInstId).count() == 0;
    }

    // ==================== 任务 ====================

    /** 当前活动任务（多任务取最早创建；无 → null）。 */
    public ActiveTask firstActiveTask(String procInstId) {
        List<Task> tasks = taskService.createTaskQuery()
                .processInstanceId(procInstId).active()
                .orderByTaskCreateTime().asc().list();
        if (tasks.isEmpty()) {
            return null;
        }
        Task t = tasks.get(0);
        return new ActiveTask(t.getId(), t.getTaskDefinitionKey(), t.getName(), t.getAssignee());
    }

    public void completeTask(String taskId) {
        taskService.complete(taskId);
    }

    public void setTaskAssignee(String taskId, String assignee) {
        taskService.setAssignee(taskId, assignee);
    }

    // ==================== 变量 ====================

    public Object getVariable(String procInstId, String name) {
        return runtimeService.getVariable(procInstId, name);
    }

    public Map<String, Object> getVariables(String procInstId) {
        return runtimeService.getVariables(procInstId);
    }

    /** 历史变量 name→value（含已结束实例；跳过空名）。 */
    public Map<String, Object> historicVariables(String procInstId) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (HistoricVariableInstance v : historyService.createHistoricVariableInstanceQuery()
                .processInstanceId(procInstId).list()) {
            if (v.getVariableName() != null) {
                out.put(v.getVariableName(), v.getValue());
            }
        }
        return out;
    }

    // ==================== 活动（高亮/预测） ====================

    /** 历史活动（跳过空 activityId）：finished=endTime!=null。 */
    public List<ActivityState> historicActivities(String procInstId) {
        List<ActivityState> out = new ArrayList<>();
        for (HistoricActivityInstance a : historyService.createHistoricActivityInstanceQuery()
                .processInstanceId(procInstId).list()) {
            if (a.getActivityId() != null) {
                out.add(new ActivityState(a.getActivityId(), a.getEndTime() != null));
            }
        }
        return out;
    }

    /** 运行时执行所在的非空 activityId 列表。 */
    public List<String> activeActivityIds(String procInstId) {
        List<String> out = new ArrayList<>();
        for (Execution ex : runtimeService.createExecutionQuery().processInstanceId(procInstId).list()) {
            if (ex.getActivityId() != null) {
                out.add(ex.getActivityId());
            }
        }
        return out;
    }
}
