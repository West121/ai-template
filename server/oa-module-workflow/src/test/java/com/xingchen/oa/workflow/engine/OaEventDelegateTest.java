package com.xingchen.oa.workflow.engine;

import com.xingchen.oa.workflow.convert.GraphToBpmnConverter;
import com.xingchen.oa.workflow.engine.script.ScriptContext;
import com.xingchen.oa.workflow.engine.script.ScriptService;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import com.xingchen.oa.workflow.support.WfAudit;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.engine.RepositoryService;
import org.flowable.task.service.delegate.DelegateTask;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link OaEventDelegate} 事件动作分发单测（Mockito，无引擎/DB）：
 * 用真实 {@link GraphToBpmnConverter} 生成含 SCRIPT 节点事件的 BpmnModel，mock {@link RepositoryService} 返回它，
 * 断言 complete 生命周期事件命中 TASK_AFTER_COMPLETE → 调 {@link ScriptService#run}（注入当前变量），
 * 且脚本对 {@code vars} 的增改回写为流程变量（{@code task.setVariable}）。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class OaEventDelegateTest {

    private final JsonMapper mapper = JsonMapper.builder().build();

    @Mock private RepositoryService repositoryService;
    @Mock private WfInstanceExtRepository instanceRepository;
    @Mock private AssigneeResolver assigneeResolver;
    @Mock private WfAudit audit;
    @Mock private ScriptService scriptService;
    @Mock private DelegateTask task;

    private OaEventDelegate delegate;

    @BeforeEach
    void setUp() {
        delegate = new OaEventDelegate(repositoryService, instanceRepository, assigneeResolver, audit, mapper, scriptService);
        lenient().when(instanceRepository.findByProcInstId(any())).thenReturn(Optional.empty());
    }

    /** 审批节点 onComplete 事件=SCRIPT（写流程变量 approved=true）：complete 命中 → 调 ScriptService → 回写变量。 */
    @Test
    void completeEventRunsScriptAndWritesBackVars() {
        BpmnModel model = converterWithScriptEvent();
        when(repositoryService.getBpmnModel("pd")).thenReturn(model);

        when(task.getEventName()).thenReturn("complete");
        when(task.getProcessDefinitionId()).thenReturn("pd");
        when(task.getTaskDefinitionKey()).thenReturn("t");
        when(task.getProcessInstanceId()).thenReturn("pid");
        when(task.getName()).thenReturn("审批");
        when(task.getVariables()).thenReturn(new HashMap<>(Map.of("days", 5)));

        // 模拟脚本执行：把 approved=true 写入 ctx.vars（wfScriptDelegate/事件 delegate 据此回写流程变量）
        when(scriptService.run(eq("groovy"), any(), any(ScriptContext.class))).thenAnswer(inv -> {
            ScriptContext ctx = inv.getArgument(2);
            ctx.vars.put("approved", true);
            return null;
        });

        delegate.notify(task);

        ArgumentCaptor<ScriptContext> ctxCap = ArgumentCaptor.forClass(ScriptContext.class);
        verify(scriptService).run(eq("groovy"), any(), ctxCap.capture());
        // 注入了当前流程变量
        assertEquals(5, ctxCap.getValue().vars.get("days"), "脚本上下文注入当前流程变量 days");
        // 脚本对 vars 的增改回写为流程变量
        verify(task).setVariable("approved", true);
    }

    /** create 生命周期事件不命中 TASK_AFTER_COMPLETE（trigger=complete 类） → 不触发脚本。 */
    @Test
    void createEventDoesNotTriggerCompleteScript() {
        BpmnModel model = converterWithScriptEvent();
        when(repositoryService.getBpmnModel("pd")).thenReturn(model);
        when(task.getEventName()).thenReturn("create");
        when(task.getProcessDefinitionId()).thenReturn("pd");
        when(task.getTaskDefinitionKey()).thenReturn("t");
        when(task.getProcessInstanceId()).thenReturn("pid");
        when(task.getVariables()).thenReturn(new HashMap<>());

        delegate.notify(task);

        verify(scriptService, never()).run(any(), any(), any());
    }

    private BpmnModel converterWithScriptEvent() {
        JsonNode root = mapper.readTree("""
                {"key": "pd", "name": "事件", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "t", "type": "userTask", "name": "审批", "position": {"x": 100, "y": 0},
                    "props": {"assigneeRules": [{"type": "ROLE", "id": 1}], "multiMode": "ANY",
                      "events": [
                        {"trigger": "TASK_AFTER_COMPLETE", "action": "SCRIPT",
                         "script": {"lang": "groovy", "code": "vars.put('approved', true)"}}
                      ]}}],
                 "edges": [{"id": "e1", "source": "start", "target": "t"}]}
                """);
        return new GraphToBpmnConverter(mapper).graphToBpmn(root);
    }
}
