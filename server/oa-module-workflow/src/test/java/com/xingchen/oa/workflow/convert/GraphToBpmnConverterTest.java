package com.xingchen.oa.workflow.convert;

import com.xingchen.oa.common.exception.BusinessException;
import org.flowable.bpmn.model.BoundaryEvent;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.CallActivity;
import org.flowable.bpmn.model.EndEvent;
import org.flowable.bpmn.model.EventDefinition;
import org.flowable.bpmn.model.ExclusiveGateway;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.IOParameter;
import org.flowable.bpmn.model.IntermediateCatchEvent;
import org.flowable.bpmn.model.MultiInstanceLoopCharacteristics;
import org.flowable.bpmn.model.Process;
import org.flowable.bpmn.model.SequenceFlow;
import org.flowable.bpmn.model.ServiceTask;
import org.flowable.bpmn.model.StartEvent;
import org.flowable.bpmn.model.SubProcess;
import org.flowable.bpmn.model.TerminateEventDefinition;
import org.flowable.bpmn.model.TimerEventDefinition;
import org.flowable.bpmn.model.UserTask;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 图直译（ProcessModel JSON → BpmnModel）单测。
 * 端到端构造「开始 → 审批 → 排它网关(两条结构化条件边 + 默认分支) → 两个结束(一个 terminate)」，
 * 断言：元素类型/数量、sequenceFlow 的 conditionExpression UEL、default 属性、BPMN DI、terminate 定义。
 */
class GraphToBpmnConverterTest {

    private final JsonMapper mapper = JsonMapper.builder().build();
    private final GraphToBpmnConverter converter = new GraphToBpmnConverter(mapper);

    private JsonNode json(String s) {
        return mapper.readTree(s);
    }

    private Process process(BpmnModel model) {
        return model.getMainProcess();
    }

    /** 开始 → 审批 → 排它网关(days>3 / days<0 + 默认) → 结束(正常) / 结束(terminate)。 */
    private JsonNode simpleApprovalGraph() {
        return json("""
                {
                  "schemaVersion": 1,
                  "key": "leave",
                  "name": "请假",
                  "formKey": "leave:1",
                  "nodes": [
                    {"id": "start", "type": "startEvent", "name": "发起", "position": {"x": 100, "y": 100}},
                    {"id": "approve", "type": "userTask", "name": "部门经理审批",
                     "position": {"x": 220, "y": 90},
                     "props": {"assigneeRules": [{"type": "LEADER", "level": 1}], "multiMode": "ANY", "emptyStrategy": "TO_ADMIN"}},
                    {"id": "gw", "type": "exclusiveGateway", "name": "天数判断", "position": {"x": 380, "y": 100}},
                    {"id": "endOk", "type": "endEvent", "name": "结束", "position": {"x": 520, "y": 60}},
                    {"id": "endNo", "type": "endEvent", "name": "驳回结束", "terminate": true, "position": {"x": 520, "y": 160}}
                  ],
                  "edges": [
                    {"id": "e1", "source": "start", "target": "approve",
                     "waypoints": [{"x": 130, "y": 115}, {"x": 220, "y": 120}]},
                    {"id": "e2", "source": "approve", "target": "gw"},
                    {"id": "e3", "source": "gw", "target": "endOk",
                     "condition": {"logic": "AND", "items": [{"field": "days", "operator": "gt", "value": "3"}]}},
                    {"id": "e4", "source": "gw", "target": "endNo",
                     "condition": {"logic": "AND", "items": [{"field": "days", "operator": "lt", "value": "0"}]}},
                    {"id": "e5", "source": "gw", "target": "endOk", "isDefault": true}
                  ]
                }
                """);
    }

    @Test
    void endToEndSimpleApprovalGraph() {
        BpmnModel model = converter.graphToBpmn(simpleApprovalGraph());
        Process p = process(model);

        // 元素类型/数量
        assertEquals(1, count(p, StartEvent.class), "1 个 startEvent");
        assertEquals(1, count(p, UserTask.class), "1 个 userTask");
        assertEquals(1, count(p, ExclusiveGateway.class), "1 个 exclusiveGateway");
        assertEquals(2, count(p, EndEvent.class), "2 个 endEvent");
        assertEquals(5, count(p, SequenceFlow.class), "5 条 sequenceFlow");

        // 审批节点：assignee 多实例 + 或签完成条件 + formKey + 扩展元素
        UserTask task = (UserTask) p.getFlowElement("approve");
        assertNotNull(task);
        assertEquals("${assignee}", task.getAssignee());
        MultiInstanceLoopCharacteristics mi = task.getLoopCharacteristics();
        assertNotNull(mi, "审批节点生成多实例");
        assertTrue(mi.getInputDataItem().contains("wfAssigneeResolver.resolve"), "collection 走审批人求值 bean");
        assertTrue(mi.getCompletionCondition().contains("nrOfCompletedInstances > 0"), "ANY 或签一票完成");
        assertEquals("leave:1", task.getFormKey(), "继承流程级 formKey");
        assertNotNull(task.getExtensionElements().get("assigneeRules"), "props.assigneeRules → oa 扩展元素");
        assertNotNull(task.getExtensionElements().get("emptyStrategy"));

        // 结构化条件编译为预期 UEL（跨端字节兼容，operator 名 gt/lt 映射为符号 > <）
        assertEquals("${days > 3}", ((SequenceFlow) p.getFlowElement("e3")).getConditionExpression());
        assertEquals("${days < 0}", ((SequenceFlow) p.getFlowElement("e4")).getConditionExpression());
        // 默认分支不带条件
        SequenceFlow def = (SequenceFlow) p.getFlowElement("e5");
        assertNull(def.getConditionExpression(), "默认分支不写 conditionExpression");
        // 无条件顺序边
        assertNull(((SequenceFlow) p.getFlowElement("e2")).getConditionExpression());

        // 网关 default 属性指向默认边
        ExclusiveGateway gw = (ExclusiveGateway) p.getFlowElement("gw");
        assertEquals("e5", gw.getDefaultFlow(), "isDefault=true 的边设为网关 default");

        // 结构化条件回编辑用 oa:condition 扩展元素
        assertNotNull(((SequenceFlow) p.getFlowElement("e3")).getExtensionElements().get("condition"),
                "结构化条件存 oa:condition 供回编辑");

        // terminate 结束事件带 TerminateEventDefinition
        EndEvent endNo = (EndEvent) p.getFlowElement("endNo");
        assertTrue(hasTerminate(endNo), "terminate=true 的 endEvent 带 terminateEventDefinition");
        EndEvent endOk = (EndEvent) p.getFlowElement("endOk");
        assertTrue(!hasTerminate(endOk), "普通 endEvent 无 terminateEventDefinition");

        // BPMN DI：每个流程节点有 BPMNShape，每条连线有 BPMNEdge
        long flowNodeCount = p.getFlowElements().stream().filter(e -> !(e instanceof SequenceFlow)).count();
        assertEquals(flowNodeCount, model.getLocationMap().size(), "每个节点都有 DI 图形坐标");
        long flowCount = p.getFlowElements().stream().filter(e -> e instanceof SequenceFlow).count();
        assertEquals(flowCount, model.getFlowLocationMap().size(), "每条连线都有 DI 路径点");
        // 消费前端坐标（非 autoLayout 合成）
        assertEquals(220.0, model.getGraphicInfo("approve").getX(), 0.001, "shape X 取自前端 position");
        assertEquals(100.0, model.getGraphicInfo("approve").getWidth(), 0.001, "userTask 默认宽 100");
        // 显式 waypoints 被消费
        assertEquals(2, model.getFlowLocationMap().get("e1").size(), "e1 消费前端显式 waypoints");
        // 缺省 waypoints 兜底为源右中→目标左中两点
        assertEquals(2, model.getFlowLocationMap().get("e2").size(), "e2 无 waypoints 兜底两点");
    }

    @Test
    void terminateOnlyWhenFlagSet() {
        BpmnModel model = converter.graphToBpmn(simpleApprovalGraph());
        EndEvent endOk = (EndEvent) process(model).getFlowElement("endOk");
        assertTrue(!hasTerminate(endOk));
    }

    @Test
    void expressionEscapeHatchWrappedWithExprEval() {
        // 高级公式串（bare formula）→ 包成 ${exprEval.evalBoolean(execution,'…')}，运行时走 Aviator（N-B-04）
        JsonNode root = json("""
                {"key": "p", "name": "p", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "gw", "type": "exclusiveGateway", "name": "网关", "position": {"x": 100, "y": 0}},
                   {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 200, "y": 0}}],
                 "edges": [
                   {"id": "e1", "source": "start", "target": "gw"},
                   {"id": "e2", "source": "gw", "target": "end", "expression": "amount > 1000"}]}
                """);
        SequenceFlow e2 = (SequenceFlow) process(converter.graphToBpmn(root)).getFlowElement("e2");
        assertEquals("${exprEval.evalBoolean(execution,'amount > 1000')}", e2.getConditionExpression(),
                "高级公式包成 exprEval.evalBoolean 交 Tier1 引擎");
        assertNull(e2.getExtensionElements().get("condition"), "expression 路径不写 oa:condition");
    }

    @Test
    void expressionSingleQuoteEscaped() {
        // 公式内含单引号/反斜杠时按 UEL 字符串字面量转义（镜像 ConditionCompiler），防破坏 UEL 结构/注入
        JsonNode root = json("""
                {"key": "p", "name": "p", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "gw", "type": "exclusiveGateway", "name": "网关", "position": {"x": 100, "y": 0}},
                   {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 200, "y": 0}}],
                 "edges": [
                   {"id": "e2", "source": "gw", "target": "end", "expression": "dept == 'HR'"}]}
                """);
        SequenceFlow e2 = (SequenceFlow) process(converter.graphToBpmn(root)).getFlowElement("e2");
        assertEquals("${exprEval.evalBoolean(execution,'dept == \\'HR\\'')}", e2.getConditionExpression(),
                "单引号转义为 \\'");
    }

    @Test
    void conditionAndExpressionMutuallyExclusive() {
        JsonNode root = json("""
                {"key": "p", "name": "p", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "gw", "type": "exclusiveGateway", "name": "网关", "position": {"x": 100, "y": 0}},
                   {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 200, "y": 0}}],
                 "edges": [
                   {"id": "e2", "source": "gw", "target": "end",
                    "expression": "${x}",
                    "condition": {"logic": "AND", "items": [{"field": "days", "operator": "gt", "value": "3"}]}}]}
                """);
        assertThrows(BusinessException.class, () -> converter.graphToBpmn(root), "同边二源互斥应拒绝");
    }

    @Test
    void unknownNodeTypeThrowsClearError() {
        // 切片 3 后全部建模类型均已支持；仅未知 type 字符串抛清晰异常（附录：仍未建模的抛清晰异常）
        JsonNode root = json("""
                {"key": "p", "name": "p", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "x", "type": "scriptTask", "name": "脚本", "position": {"x": 100, "y": 0}}],
                 "edges": []}
                """);
        BusinessException ex = assertThrows(BusinessException.class, () -> converter.graphToBpmn(root));
        assertTrue(ex.getMessage().contains("未知流程节点类型"), "未建模类型抛清晰异常");
    }

    /** 并行网关（切片 2a）：单网关直译 fork/join（前端显式成对）+ 无条件出边全激活/汇聚。 */
    @Test
    void parallelGatewayForkJoin() {
        JsonNode root = json("""
                {"key": "p", "name": "并行会签", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 60}},
                   {"id": "fork", "type": "parallelGateway", "name": "并行开始", "position": {"x": 100, "y": 60}},
                   {"id": "t1", "type": "userTask", "name": "财务", "position": {"x": 200, "y": 0},
                    "props": {"assigneeRules": [{"type": "ROLE", "id": 1}], "multiMode": "ANY"}},
                   {"id": "t2", "type": "userTask", "name": "法务", "position": {"x": 200, "y": 120},
                    "props": {"assigneeRules": [{"type": "ROLE", "id": 2}], "multiMode": "ANY"}},
                   {"id": "join", "type": "parallelGateway", "name": "并行汇聚", "position": {"x": 320, "y": 60}},
                   {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 420, "y": 60}}],
                 "edges": [
                   {"id": "e1", "source": "start", "target": "fork"},
                   {"id": "e2", "source": "fork", "target": "t1"},
                   {"id": "e3", "source": "fork", "target": "t2"},
                   {"id": "e4", "source": "t1", "target": "join"},
                   {"id": "e5", "source": "t2", "target": "join"},
                   {"id": "e6", "source": "join", "target": "end"}]}
                """);
        Process p = process(converter.graphToBpmn(root));
        assertEquals(2, count(p, org.flowable.bpmn.model.ParallelGateway.class), "两个 parallelGateway(fork/join)");
        assertEquals(2, count(p, UserTask.class), "两个并行审批任务");
        // 并行 fork 出边无条件
        assertNull(((SequenceFlow) p.getFlowElement("e2")).getConditionExpression(), "并行出边无条件");
        assertNull(((SequenceFlow) p.getFlowElement("e3")).getConditionExpression(), "并行出边无条件");
        org.flowable.bpmn.model.ParallelGateway fork =
                (org.flowable.bpmn.model.ParallelGateway) p.getFlowElement("fork");
        assertNull(fork.getDefaultFlow(), "并行网关不设默认分支");
    }

    /** 包容网关（切片 2a）：单网关直译，满足的多分支都走 + 默认分支同 exclusive。 */
    @Test
    void inclusiveGatewayWithDefault() {
        JsonNode root = json("""
                {"key": "p", "name": "包容分支", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 60}},
                   {"id": "ig", "type": "inclusiveGateway", "name": "包容判断", "position": {"x": 100, "y": 60}},
                   {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 300, "y": 60}}],
                 "edges": [
                   {"id": "e1", "source": "start", "target": "ig"},
                   {"id": "e2", "source": "ig", "target": "end",
                    "condition": {"logic": "AND", "items": [{"field": "amount", "operator": "gt", "value": "1000"}]}},
                   {"id": "e3", "source": "ig", "target": "end",
                    "condition": {"logic": "AND", "items": [{"field": "urgent", "operator": "eq", "value": "true"}]}},
                   {"id": "e4", "source": "ig", "target": "end", "isDefault": true}]}
                """);
        Process p = process(converter.graphToBpmn(root));
        assertEquals(1, count(p, org.flowable.bpmn.model.InclusiveGateway.class), "1 个 inclusiveGateway");
        // 结构化条件仍编译 UEL（跨端字节兼容）
        assertEquals("${amount > 1000}", ((SequenceFlow) p.getFlowElement("e2")).getConditionExpression());
        assertEquals("${urgent == 'true'}", ((SequenceFlow) p.getFlowElement("e3")).getConditionExpression());
        assertNull(((SequenceFlow) p.getFlowElement("e4")).getConditionExpression(), "默认分支不带条件");
        // 默认分支同 exclusive 处理：设为网关 default
        org.flowable.bpmn.model.InclusiveGateway ig =
                (org.flowable.bpmn.model.InclusiveGateway) p.getFlowElement("ig");
        assertEquals("e4", ig.getDefaultFlow(), "inclusive 默认分支设为网关 default");
    }

    /* ==================== 切片 3：OA 行为节点 / 通用 serviceTask ==================== */

    /** serviceTask 四种 impl：autoApprove/autoReject → wfAutoDecide；delegate → 直配；均落 serviceTask。 */
    @Test
    void serviceTaskImplAutoDecideAndDelegate() {
        JsonNode root = json("""
                {"key": "p", "name": "自动决策", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "pass", "type": "serviceTask", "name": "自动通过", "position": {"x": 100, "y": 0},
                    "service": {"impl": "autoApprove"}},
                   {"id": "deny", "type": "serviceTask", "name": "自动拒绝", "position": {"x": 200, "y": 0},
                    "service": {"impl": "autoReject"}},
                   {"id": "custom", "type": "serviceTask", "name": "自定义委托", "position": {"x": 300, "y": 0},
                    "service": {"impl": "delegate", "delegateExpression": "${myBean}"}},
                   {"id": "end", "type": "endEvent", "name": "结束", "terminate": true, "position": {"x": 400, "y": 0}}],
                 "edges": [
                   {"id": "e1", "source": "start", "target": "pass"},
                   {"id": "e2", "source": "pass", "target": "deny"},
                   {"id": "e3", "source": "deny", "target": "custom"},
                   {"id": "e4", "source": "custom", "target": "end"}]}
                """);
        Process p = process(converter.graphToBpmn(root));
        assertEquals(3, count(p, ServiceTask.class), "三个 serviceTask");

        ServiceTask pass = (ServiceTask) p.getFlowElement("pass");
        assertEquals("${wfAutoDecide}", pass.getImplementation());
        assertEquals("APPROVE", pass.getExtensionElements().get("autoDecision").get(0).getElementText());

        ServiceTask deny = (ServiceTask) p.getFlowElement("deny");
        assertEquals("${wfAutoDecide}", deny.getImplementation());
        assertEquals("REJECT", deny.getExtensionElements().get("autoDecision").get(0).getElementText());
        // 附录 C.3：autoReject 不再隐式补 terminate end（仅前端显式 endEvent{terminate} 承接）
        assertEquals(1, count(p, EndEvent.class), "无隐式补的终止结束事件");

        ServiceTask custom = (ServiceTask) p.getFlowElement("custom");
        assertEquals("${myBean}", custom.getImplementation(), "通用 delegate 直配 delegateExpression");
    }

    /** serviceTask{impl:"script"}：→ wfScriptDelegate，lang/code 存 oa 扩展 scriptLang/scriptCode。 */
    @Test
    void scriptTaskToWfScriptDelegate() {
        JsonNode root = json("""
                {"key": "p", "name": "脚本节点", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "sc", "type": "serviceTask", "name": "计算总额", "position": {"x": 100, "y": 0},
                    "service": {"impl": "script"},
                    "script": {"lang": "groovy", "code": "vars.put('total', vars.get('price') * vars.get('qty'))"}}],
                 "edges": [{"id": "e1", "source": "start", "target": "sc"}]}
                """);
        ServiceTask sc = (ServiceTask) process(converter.graphToBpmn(root)).getFlowElement("sc");
        assertEquals("${wfScriptDelegate}", sc.getImplementation(), "脚本节点走 wfScriptDelegate");
        assertEquals("groovy", sc.getExtensionElements().get("scriptLang").get(0).getElementText());
        assertTrue(sc.getExtensionElements().get("scriptCode").get(0).getElementText().contains("vars.put('total'"),
                "脚本体存 oa:scriptCode");
    }

    /** serviceTask{impl:"script"} 缺 script.lang/code → 清晰异常。 */
    @Test
    void scriptTaskMissingLangOrCodeThrows() {
        JsonNode root = json("""
                {"key": "p", "name": "p", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "sc", "type": "serviceTask", "name": "脚本", "position": {"x": 100, "y": 0},
                    "service": {"impl": "script"}, "script": {"lang": "groovy"}}],
                 "edges": [{"id": "e1", "source": "start", "target": "sc"}]}
                """);
        BusinessException ex = assertThrows(BusinessException.class, () -> converter.graphToBpmn(root));
        assertTrue(ex.getMessage().contains("script.lang/script.code"));
    }

    /** serviceTask{delegate} 缺 delegateExpression → 清晰异常。 */
    @Test
    void serviceTaskDelegateMissingExpressionThrows() {
        JsonNode root = json("""
                {"key": "p", "name": "p", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "d", "type": "serviceTask", "name": "委托", "position": {"x": 100, "y": 0},
                    "service": {"impl": "delegate"}}],
                 "edges": [{"id": "e1", "source": "start", "target": "d"}]}
                """);
        BusinessException ex = assertThrows(BusinessException.class, () -> converter.graphToBpmn(root));
        assertTrue(ex.getMessage().contains("delegateExpression"));
    }

    /** trigger：serviceTask → wfTriggerDelegate，triggerType/handler/webhookUrl 存 oa 扩展。 */
    @Test
    void triggerServiceTask() {
        JsonNode root = json("""
                {"key": "p", "name": "触发", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "trig", "type": "serviceTask", "name": "触发器", "position": {"x": 100, "y": 0},
                    "service": {"impl": "trigger", "triggerType": "IMMEDIATE", "handler": "wfEchoTrigger"}}],
                 "edges": [{"id": "e1", "source": "start", "target": "trig"}]}
                """);
        ServiceTask trig = (ServiceTask) process(converter.graphToBpmn(root)).getFlowElement("trig");
        assertEquals("${wfTriggerDelegate}", trig.getImplementation());
        assertEquals("IMMEDIATE", trig.getExtensionElements().get("triggerType").get(0).getElementText());
        assertEquals("wfEchoTrigger", trig.getExtensionElements().get("triggerHandler").get(0).getElementText());
    }

    /** cc：serviceTask → wfCcDelegate，抄送人取 props.ccUsers（附录 A.3 迁移）。 */
    @Test
    void ccServiceTaskReadsPropsCcUsers() {
        JsonNode root = json("""
                {"key": "p", "name": "抄送", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "cc", "type": "cc", "name": "抄送人事", "position": {"x": 100, "y": 0},
                    "props": {"ccUsers": [{"kind": "USER", "id": 3}]}}],
                 "edges": [{"id": "e1", "source": "start", "target": "cc"}]}
                """);
        ServiceTask cc = (ServiceTask) process(converter.graphToBpmn(root)).getFlowElement("cc");
        assertEquals("${wfCcDelegate}", cc.getImplementation());
        assertNotNull(cc.getExtensionElements().get("ccUsers"), "ccUsers 取自 props.ccUsers 写 oa 扩展");
        assertTrue(cc.getExtensionElements().get("ccUsers").get(0).getElementText().contains("USER"));
    }

    /** ai：serviceTask → wfAiApprovalDelegate，config 取自 node.ai。 */
    @Test
    void aiServiceTask() {
        JsonNode root = json("""
                {"key": "p", "name": "AI", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "ai", "type": "ai", "name": "AI审批", "position": {"x": 100, "y": 0},
                    "ai": {"model": "gpt-4o", "systemPrompt": "审批请假", "formContext": ["days"],
                           "outputMap": {"decision": "aiDecision", "comment": "aiComment"}}}],
                 "edges": [{"id": "e1", "source": "start", "target": "ai"}]}
                """);
        ServiceTask ai = (ServiceTask) process(converter.graphToBpmn(root)).getFlowElement("ai");
        assertEquals("${wfAiApprovalDelegate}", ai.getImplementation());
        assertEquals("gpt-4o", ai.getExtensionElements().get("aiModel").get(0).getElementText());
        assertEquals("审批请假", ai.getExtensionElements().get("aiSystemPrompt").get(0).getElementText());
        assertNotNull(ai.getExtensionElements().get("aiFormContext"));
        assertNotNull(ai.getExtensionElements().get("aiOutputMap"));
    }

    /** webhook：serviceTask → wfWebhookDelegate，url 取自 node.webhook.url。 */
    @Test
    void webhookServiceTask() {
        JsonNode root = json("""
                {"key": "p", "name": "webhook", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "wh", "type": "webhook", "name": "回调", "position": {"x": 100, "y": 0},
                    "webhook": {"url": "https://example.com/hook"}}],
                 "edges": [{"id": "e1", "source": "start", "target": "wh"}]}
                """);
        ServiceTask wh = (ServiceTask) process(converter.graphToBpmn(root)).getFlowElement("wh");
        assertEquals("${wfWebhookDelegate}", wh.getImplementation());
        assertEquals("https://example.com/hook", wh.getExtensionElements().get("webhookUrl").get(0).getElementText());
    }

    /* ==================== 切片 3：callActivity / 嵌入式 subProcess ==================== */

    /** callActivity：calledElement + inheritVariables + inParameters(child←parent)。 */
    @Test
    void callActivityWithParamMap() {
        JsonNode root = json("""
                {"key": "p", "name": "调用子流程", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "call", "type": "callActivity", "name": "外部审批", "position": {"x": 100, "y": 0},
                    "callActivity": {"calledElement": "leave_approval", "async": false,
                                     "paramMap": [{"child": "subDays", "parent": "days"}]}}],
                 "edges": [{"id": "e1", "source": "start", "target": "call"}]}
                """);
        CallActivity call = (CallActivity) process(converter.graphToBpmn(root)).getFlowElement("call");
        assertEquals("leave_approval", call.getCalledElement());
        assertTrue(call.isInheritVariables(), "默认继承父变量");
        assertEquals(1, call.getInParameters().size());
        IOParameter p0 = call.getInParameters().get(0);
        assertEquals("subDays", p0.getTarget(), "target=子流程变量");
        assertEquals("days", p0.getSource(), "source=父字段");
    }

    /** 嵌入式 subProcess：递归转换 children 子图为 SubProcess 内联元素。 */
    @Test
    void embeddedSubProcessRecursion() {
        JsonNode root = json("""
                {"key": "p", "name": "嵌入子流程", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 60}},
                   {"id": "sp", "type": "subProcess", "name": "内部处理", "position": {"x": 100, "y": 60},
                    "size": {"w": 300, "h": 200},
                    "children": {
                       "nodes": [
                         {"id": "sStart", "type": "startEvent", "name": "子开始", "position": {"x": 120, "y": 80}},
                         {"id": "sTask", "type": "userTask", "name": "内部审批", "position": {"x": 200, "y": 80},
                          "props": {"assigneeRules": [{"type": "ROLE", "id": 1}], "multiMode": "ANY"}},
                         {"id": "sEnd", "type": "endEvent", "name": "子结束", "position": {"x": 320, "y": 80}}],
                       "edges": [
                         {"id": "se1", "source": "sStart", "target": "sTask"},
                         {"id": "se2", "source": "sTask", "target": "sEnd"}]}},
                   {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 460, "y": 60}}],
                 "edges": [
                   {"id": "e1", "source": "start", "target": "sp"},
                   {"id": "e2", "source": "sp", "target": "end"}]}
                """);
        BpmnModel model = converter.graphToBpmn(root);
        Process p = process(model);
        SubProcess sp = (SubProcess) p.getFlowElement("sp");
        assertNotNull(sp, "顶层含 subProcess 节点");
        // 递归子元素在 SubProcess 容器内（非顶层 process 直接子元素）
        assertNull(p.getFlowElement("sTask"), "子流程内元素不在顶层 process 直接子元素");
        assertNotNull(sp.getFlowElement("sTask"), "子流程内 userTask 递归建入 SubProcess");
        assertNotNull(sp.getFlowElement("sStart"));
        assertNotNull(sp.getFlowElement("sEnd"));
        UserTask sTask = (UserTask) sp.getFlowElement("sTask");
        assertEquals("${assignee}", sTask.getAssignee(), "子流程审批节点同样生成多实例审批人");
        // 子元素也补 DI（全局按 id 挂）
        assertNotNull(model.getGraphicInfo("sTask"), "子流程内节点也补 BPMN DI");
        assertEquals(300.0, model.getGraphicInfo("sp").getWidth(), 0.001, "subProcess 尺寸取自前端 size");
    }

    /* ==================== 切片 3：定时 timerCatch / timerBoundary / cycle ==================== */

    /** timerCatch：intermediateCatchEvent + timerEventDefinition，duration/date/cycle 三态。 */
    @Test
    void timerCatchDurationDateCycle() {
        JsonNode root = json("""
                {"key": "p", "name": "定时", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "td", "type": "timerCatch", "name": "等5秒", "position": {"x": 100, "y": 0},
                    "timer": {"mode": "duration", "value": "PT5S"}},
                   {"id": "tdate", "type": "timerCatch", "name": "到点", "position": {"x": 200, "y": 0},
                    "timer": {"mode": "date", "value": "2026-08-01T09:00:00"}},
                   {"id": "tcyc", "type": "timerCatch", "name": "周期", "position": {"x": 300, "y": 0},
                    "timer": {"mode": "cycle", "value": "R3/PT10M"}},
                   {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 400, "y": 0}}],
                 "edges": [
                   {"id": "e1", "source": "start", "target": "td"},
                   {"id": "e2", "source": "td", "target": "tdate"},
                   {"id": "e3", "source": "tdate", "target": "tcyc"},
                   {"id": "e4", "source": "tcyc", "target": "end"}]}
                """);
        Process p = process(converter.graphToBpmn(root));
        assertEquals(3, count(p, IntermediateCatchEvent.class), "三个 timerCatch");
        assertEquals("PT5S", timerOf((IntermediateCatchEvent) p.getFlowElement("td")).getTimeDuration());
        assertEquals("2026-08-01T09:00:00", timerOf((IntermediateCatchEvent) p.getFlowElement("tdate")).getTimeDate());
        assertEquals("R3/PT10M", timerOf((IntermediateCatchEvent) p.getFlowElement("tcyc")).getTimeCycle(), "周期定时 timeCycle");
    }

    /** timerBoundary：boundaryEvent + attachedToRef 关联宿主 + cancelActivity 中断/非中断。 */
    @Test
    void timerBoundaryAttachedAndCancelActivity() {
        JsonNode root = json("""
                {"key": "p", "name": "边界定时", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 60}},
                   {"id": "task", "type": "userTask", "name": "限时审批", "position": {"x": 100, "y": 60},
                    "props": {"assigneeRules": [{"type": "ROLE", "id": 1}], "multiMode": "ANY"}},
                   {"id": "bInt", "type": "timerBoundary", "name": "超时中断", "position": {"x": 140, "y": 110},
                    "attachedTo": "task", "cancelActivity": true, "timer": {"mode": "duration", "value": "PT1H"}},
                   {"id": "bNon", "type": "timerBoundary", "name": "超时提醒", "position": {"x": 160, "y": 110},
                    "attachedTo": "task", "cancelActivity": false, "timer": {"mode": "cycle", "value": "R/PT30M"}},
                   {"id": "esc", "type": "endEvent", "name": "超时结束", "terminate": true, "position": {"x": 260, "y": 140}},
                   {"id": "remind", "type": "cc", "name": "提醒抄送", "position": {"x": 260, "y": 200},
                    "props": {"ccUsers": [{"kind": "USER", "id": 1}]}},
                   {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 260, "y": 60}}],
                 "edges": [
                   {"id": "e1", "source": "start", "target": "task"},
                   {"id": "e2", "source": "task", "target": "end"},
                   {"id": "e3", "source": "bInt", "target": "esc"},
                   {"id": "e4", "source": "bNon", "target": "remind"}]}
                """);
        Process p = process(converter.graphToBpmn(root));
        assertEquals(2, count(p, BoundaryEvent.class), "两个 boundaryEvent");
        BoundaryEvent bInt = (BoundaryEvent) p.getFlowElement("bInt");
        assertNotNull(bInt.getAttachedToRef(), "边界事件回填宿主 Activity");
        assertEquals("task", bInt.getAttachedToRef().getId(), "attachedToRef 指向宿主 userTask");
        assertEquals("task", bInt.getAttachedToRefId());
        assertTrue(bInt.isCancelActivity(), "中断型 cancelActivity=true");
        assertEquals("PT1H", timerOf(bInt).getTimeDuration());

        BoundaryEvent bNon = (BoundaryEvent) p.getFlowElement("bNon");
        assertTrue(!bNon.isCancelActivity(), "非中断型 cancelActivity=false");
        assertEquals("R/PT30M", timerOf(bNon).getTimeCycle());
    }

    /** timerBoundary 的 attachedTo 指向非活动节点（网关）→ 清晰异常。 */
    @Test
    void timerBoundaryBadAttachedThrows() {
        JsonNode root = json("""
                {"key": "p", "name": "p", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "gw", "type": "exclusiveGateway", "name": "网关", "position": {"x": 100, "y": 0}},
                   {"id": "b", "type": "timerBoundary", "name": "边界", "position": {"x": 120, "y": 40},
                    "attachedTo": "gw", "timer": {"mode": "duration", "value": "PT1H"}}],
                 "edges": [{"id": "e1", "source": "start", "target": "gw"}]}
                """);
        BusinessException ex = assertThrows(BusinessException.class, () -> converter.graphToBpmn(root));
        assertTrue(ex.getMessage().contains("attachedTo"), "边界宿主非活动节点抛清晰异常");
    }

    /* ==================== 事件监听器：节点 SCRIPT/API + 流程级 ==================== */

    /**
     * 节点事件 SCRIPT/API：整条 events[] 存 oa:events 扩展（含 script{lang,code} / api{method,url,headers,body}），
     * 并按 trigger 挂 taskListener {@code ${wfEventDelegate}}（complete/delete），运行时读回分发。
     */
    @Test
    void nodeEventsScriptAndApiSerialized() {
        JsonNode root = json("""
                {"key": "p", "name": "事件", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "t", "type": "userTask", "name": "审批", "position": {"x": 100, "y": 0},
                    "props": {"assigneeRules": [{"type": "ROLE", "id": 1}], "multiMode": "ANY",
                      "events": [
                        {"trigger": "TASK_AFTER_COMPLETE", "action": "SCRIPT",
                         "script": {"lang": "groovy", "code": "vars.put('approved', true)"}},
                        {"trigger": "TASK_AFTER_UNDO", "action": "API",
                         "api": {"method": "POST", "url": "http://localhost:9/hook",
                                 "headers": "X-Token: abc", "body": "{\\"k\\":1}"}}
                      ]}}],
                 "edges": [{"id": "e1", "source": "start", "target": "t"}]}
                """);
        UserTask t = (UserTask) process(converter.graphToBpmn(root)).getFlowElement("t");
        // 整条 events JSON 存 oa:events（NOTIFY/WEBHOOK/SCRIPT/API 一套序列化，delegate 运行时读回）
        String eventsText = t.getExtensionElements().get("events").get(0).getElementText();
        assertTrue(eventsText.contains("\"action\":\"SCRIPT\""), "SCRIPT 动作序列化进 oa:events");
        assertTrue(eventsText.contains("\"lang\":\"groovy\""), "script.lang 无损");
        assertTrue(eventsText.contains("vars.put('approved'"), "script.code 无损");
        assertTrue(eventsText.contains("\"action\":\"API\""), "API 动作序列化进 oa:events");
        assertTrue(eventsText.contains("http://localhost:9/hook"), "api.url 无损");
        assertTrue(eventsText.contains("X-Token: abc"), "api.headers 文本无损");
        // trigger → taskListener：complete（SCRIPT）+ delete（API），均 ${wfEventDelegate}
        List<org.flowable.bpmn.model.FlowableListener> listeners = t.getTaskListeners();
        assertEquals(2, listeners.size(), "两个 trigger → 两个 taskListener");
        assertTrue(listeners.stream().allMatch(l -> "${wfEventDelegate}".equals(l.getImplementation())));
        assertTrue(listeners.stream().anyMatch(l -> "complete".equals(l.getEvent())), "TASK_AFTER_COMPLETE→complete");
        assertTrue(listeners.stream().anyMatch(l -> "delete".equals(l.getEvent())), "TASK_AFTER_UNDO→delete");
    }

    /**
     * 流程级事件：flowConfig.events（ProcessEvent[]）→ 流程级 executionListener（start/end）。
     * PROCESS_START→start、PROCESS_END→end 落地；PROCESS_CANCEL 暂不挂（TODO）。事件配置整体存 oa:flowConfig。
     */
    @Test
    void processEventsToExecutionListeners() {
        JsonNode root = json("""
                {"key": "p", "name": "流程事件", "flowConfig": {
                   "events": [
                     {"trigger": "PROCESS_START", "action": "SCRIPT", "script": {"lang": "js", "code": "vars.started = true"}},
                     {"trigger": "PROCESS_END", "action": "API", "api": {"method": "PUT", "url": "http://localhost:9/close"}},
                     {"trigger": "PROCESS_CANCEL", "action": "NOTIFY", "notify": {"to": [], "template": "已撤销"}}
                   ]},
                 "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 100, "y": 0}}],
                 "edges": [{"id": "e1", "source": "start", "target": "end"}]}
                """);
        Process p = process(converter.graphToBpmn(root));
        List<org.flowable.bpmn.model.FlowableListener> listeners = p.getExecutionListeners();
        assertEquals(2, listeners.size(), "PROCESS_START/END → 2 个 executionListener（CANCEL 不挂）");
        assertTrue(listeners.stream().allMatch(l -> "${wfEventDelegate}".equals(l.getImplementation())));
        assertTrue(listeners.stream().anyMatch(l -> "start".equals(l.getEvent())), "PROCESS_START→start");
        assertTrue(listeners.stream().anyMatch(l -> "end".equals(l.getEvent())), "PROCESS_END→end");
        assertTrue(listeners.stream().noneMatch(l -> "cancel".equals(l.getEvent())), "PROCESS_CANCEL 不挂 process-level 监听");
        // 事件配置整体存 oa:flowConfig，delegate 运行时读回
        String fc = p.getExtensionElements().get("flowConfig").get(0).getElementText();
        assertTrue(fc.contains("PROCESS_START") && fc.contains("vars.started"), "flowConfig.events 无损存 oa:flowConfig");
    }

    private TimerEventDefinition timerOf(org.flowable.bpmn.model.Event event) {
        for (EventDefinition ed : event.getEventDefinitions()) {
            if (ed instanceof TimerEventDefinition ted) {
                return ted;
            }
        }
        return null;
    }

    private long count(Process p, Class<? extends FlowElement> type) {
        return p.getFlowElements().stream().filter(type::isInstance).count();
    }

    private boolean hasTerminate(EndEvent end) {
        for (EventDefinition ed : end.getEventDefinitions()) {
            if (ed instanceof TerminateEventDefinition) {
                return true;
            }
        }
        return false;
    }
}
