package com.xingchen.oa.workflow.convert;

import com.xingchen.oa.common.exception.BusinessException;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.EndEvent;
import org.flowable.bpmn.model.EventDefinition;
import org.flowable.bpmn.model.ExclusiveGateway;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.MultiInstanceLoopCharacteristics;
import org.flowable.bpmn.model.Process;
import org.flowable.bpmn.model.SequenceFlow;
import org.flowable.bpmn.model.StartEvent;
import org.flowable.bpmn.model.TerminateEventDefinition;
import org.flowable.bpmn.model.UserTask;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

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
    void expressionEscapeHatchWrittenRaw() {
        JsonNode root = json("""
                {"key": "p", "name": "p", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "gw", "type": "exclusiveGateway", "name": "网关", "position": {"x": 100, "y": 0}},
                   {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 200, "y": 0}}],
                 "edges": [
                   {"id": "e1", "source": "start", "target": "gw"},
                   {"id": "e2", "source": "gw", "target": "end", "expression": "${exprEval.eval(execution,'amount > 1000')}"}]}
                """);
        SequenceFlow e2 = (SequenceFlow) process(converter.graphToBpmn(root)).getFlowElement("e2");
        assertEquals("${exprEval.eval(execution,'amount > 1000')}", e2.getConditionExpression(), "高级公式原样下发");
        assertNull(e2.getExtensionElements().get("condition"), "expression 路径不写 oa:condition");
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
    void unsupportedNodeTypeThrowsClearError() {
        JsonNode root = json("""
                {"key": "p", "name": "p", "nodes": [
                   {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 0}},
                   {"id": "sp", "type": "subProcess", "name": "子流程", "position": {"x": 100, "y": 0}}],
                 "edges": []}
                """);
        BusinessException ex = assertThrows(BusinessException.class, () -> converter.graphToBpmn(root));
        assertTrue(ex.getMessage().contains("暂不支持"), "切片 2 剩余类型抛清晰暂不支持异常");
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
