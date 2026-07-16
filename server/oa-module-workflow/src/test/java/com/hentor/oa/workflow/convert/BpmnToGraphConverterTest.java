package com.hentor.oa.workflow.convert;

import com.hentor.oa.workflow.convert.graph.FlowNodeDto;
import com.hentor.oa.workflow.convert.graph.ProcessModel;
import com.hentor.oa.workflow.convert.graph.SequenceFlowDto;
import org.flowable.bpmn.converter.BpmnXMLConverter;
import org.flowable.bpmn.model.BpmnModel;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 逆向图直译（BpmnModel → ProcessModel）+ .bpmn 往返自洽单测。
 *
 * <p>核心路径：构造 {@link ProcessModel}（核心类型）→ {@link GraphToBpmnConverter} → {@code BpmnXMLConverter} 出 XML
 * → {@link BpmnToGraphConverter#importXml} 回 {@link ProcessModel}，断言结构等价（节点类型/数量、条件、default、
 * 坐标从 DI 还原、terminate、oa: 扩展回 props）。
 */
class BpmnToGraphConverterTest {

    private final JsonMapper mapper = JsonMapper.builder().build();
    private final GraphToBpmnConverter forward = new GraphToBpmnConverter(mapper);
    private final BpmnToGraphConverter reverse = new BpmnToGraphConverter(mapper);

    private JsonNode json(String s) {
        return mapper.readTree(s);
    }

    private FlowNodeDto node(ProcessModel pm, String id) {
        return pm.nodes.stream().filter(n -> id.equals(n.id)).findFirst().orElse(null);
    }

    private SequenceFlowDto edge(ProcessModel pm, String id) {
        return pm.edges.stream().filter(e -> id.equals(e.id)).findFirst().orElse(null);
    }

    /** ProcessModel → BpmnModel → XML → BpmnModel → ProcessModel。 */
    private ProcessModel roundTrip(JsonNode graph, List<String> warnings) {
        BpmnModel fwd = forward.graphToBpmn(graph);
        byte[] xml = new BpmnXMLConverter().convertToXML(fwd);
        return reverse.importXml(new String(xml, StandardCharsets.UTF_8), warnings);
    }

    /** 核心类型往返：start/userTask/exclusiveGateway/cc/serviceTask(autoApprove)/end(terminate) + 三态条件边。 */
    @Test
    void coreTypesRoundTripStructurallyEquivalent() {
        JsonNode graph = json("""
                {
                  "schemaVersion": 1,
                  "key": "leave",
                  "name": "请假",
                  "formKey": "leave:1",
                  "nodes": [
                    {"id": "start", "type": "startEvent", "name": "发起", "position": {"x": 100, "y": 100}},
                    {"id": "approve", "type": "userTask", "name": "部门经理审批",
                     "position": {"x": 220, "y": 90}, "size": {"w": 120, "h": 70},
                     "props": {"assigneeRules": [{"type": "LEADER", "level": 1}], "multiMode": "ALL",
                               "emptyStrategy": "TO_ADMIN", "commentRequired": true}},
                    {"id": "gw", "type": "exclusiveGateway", "name": "天数判断", "position": {"x": 380, "y": 100}},
                    {"id": "ccNode", "type": "cc", "name": "抄送人事", "position": {"x": 500, "y": 40},
                     "props": {"ccUsers": [{"kind": "USER", "id": 3}]}},
                    {"id": "autoOk", "type": "serviceTask", "name": "自动通过", "position": {"x": 500, "y": 120},
                     "service": {"impl": "autoApprove"}},
                    {"id": "endOk", "type": "endEvent", "name": "结束", "position": {"x": 640, "y": 60}},
                    {"id": "endNo", "type": "endEvent", "name": "终止", "terminate": true, "position": {"x": 640, "y": 180}}
                  ],
                  "edges": [
                    {"id": "e1", "source": "start", "target": "approve",
                     "waypoints": [{"x": 130, "y": 115}, {"x": 220, "y": 120}]},
                    {"id": "e2", "source": "approve", "target": "gw"},
                    {"id": "e3", "source": "gw", "target": "ccNode",
                     "condition": {"logic": "AND", "items": [{"field": "days", "operator": "gt", "value": "3"}]}},
                    {"id": "e4", "source": "gw", "target": "autoOk", "expression": "amount > 1000"},
                    {"id": "e5", "source": "gw", "target": "endNo", "isDefault": true},
                    {"id": "e6", "source": "ccNode", "target": "endOk"},
                    {"id": "e7", "source": "autoOk", "target": "endOk"}
                  ]
                }
                """);
        List<String> warnings = new ArrayList<>();
        ProcessModel pm = roundTrip(graph, warnings);

        // 顶层
        assertEquals("leave", pm.key);
        assertEquals("请假", pm.name);
        assertEquals(7, pm.nodes.size(), "7 个节点全部还原");
        assertEquals(7, pm.edges.size(), "7 条边全部还原");
        assertTrue(warnings.isEmpty(), "核心类型无损还原，无 warning: " + warnings);

        // 节点类型
        assertEquals("startEvent", node(pm, "start").type);
        assertEquals("userTask", node(pm, "approve").type);
        assertEquals("exclusiveGateway", node(pm, "gw").type);
        assertEquals("cc", node(pm, "ccNode").type, "wfCcDelegate 反查回一等 cc 节点");
        assertEquals("serviceTask", node(pm, "autoOk").type);
        assertEquals("autoApprove", node(pm, "autoOk").service.path("impl").asString(), "autoDecision APPROVE→autoApprove");

        // userTask：oa: 扩展回 props + formKey
        FlowNodeDto approve = node(pm, "approve");
        assertEquals("leave:1", approve.formKey, "formKey 从 userTask 还原");
        assertEquals("ALL", approve.props.path("multiMode").asString());
        assertEquals("TO_ADMIN", approve.props.path("emptyStrategy").asString());
        assertTrue(approve.props.path("commentRequired").asBoolean(false), "commentRequired 布尔回读");
        assertEquals("LEADER", approve.props.path("assigneeRules").get(0).path("type").asString(), "assigneeRules 数组回读");

        // cc 节点 props.ccUsers 回读
        assertEquals("USER", node(pm, "ccNode").props.path("ccUsers").get(0).path("kind").asString());

        // 坐标从 DI 还原（position/size）
        assertEquals(220.0, approve.position.x, 0.001, "position.x 从 BPMNShape 还原");
        assertEquals(90.0, approve.position.y, 0.001);
        assertNotNull(approve.size, "size 从 BPMNShape 宽高还原");
        assertEquals(120.0, approve.size.w, 0.001);
        assertEquals(70.0, approve.size.h, 0.001);

        // terminate
        assertNull(node(pm, "endOk").terminate, "普通结束无 terminate");
        assertTrue(Boolean.TRUE.equals(node(pm, "endNo").terminate), "terminate 结束事件回读 terminate=true");

        // 条件三态
        SequenceFlowDto e3 = edge(pm, "e3");
        assertNotNull(e3.condition, "结构化条件从 oa:condition 回读");
        assertEquals("gt", e3.condition.path("items").get(0).path("operator").asString(), "operator 名形保留(不反解符号)");
        assertEquals("days", e3.condition.path("items").get(0).path("field").asString());
        assertNull(e3.expression, "结构化边不落 expression");

        SequenceFlowDto e4 = edge(pm, "e4");
        assertEquals("amount > 1000", e4.expression, "exprEval 包裹解回原始公式串");
        assertNull(e4.condition);

        SequenceFlowDto e5 = edge(pm, "e5");
        assertTrue(Boolean.TRUE.equals(e5.isDefault), "网关 default 出边回读 isDefault");
        assertNull(e5.condition);
        assertNull(e5.expression);

        // 无条件顺序边
        assertNull(edge(pm, "e2").condition);
        assertNull(edge(pm, "e2").expression);
        assertNull(edge(pm, "e2").isDefault);

        // waypoints 从 BPMNEdge 还原
        assertNotNull(edge(pm, "e1").waypoints);
        assertEquals(2, edge(pm, "e1").waypoints.size(), "e1 显式 waypoints 从 DI 还原");
    }

    /** 并行/包容网关 + ai/webhook/script/trigger/delegate serviceTask 往返。 */
    @Test
    void gatewaysAndServiceVariantsRoundTrip() {
        JsonNode graph = json("""
                {
                  "key": "p", "name": "多类型",
                  "nodes": [
                    {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 60}},
                    {"id": "fork", "type": "parallelGateway", "name": "并行", "position": {"x": 100, "y": 60}},
                    {"id": "ai", "type": "ai", "name": "AI审批", "position": {"x": 200, "y": 0},
                     "ai": {"model": "gpt-4o", "systemPrompt": "审批", "formContext": ["days"],
                            "outputMap": {"decision": "aiDecision"}}},
                    {"id": "wh", "type": "webhook", "name": "回调", "position": {"x": 200, "y": 60},
                     "webhook": {"url": "https://example.com/hook"}},
                    {"id": "sc", "type": "serviceTask", "name": "脚本", "position": {"x": 200, "y": 120},
                     "service": {"impl": "script"}, "script": {"lang": "groovy", "code": "vars.put('x', 1)"}},
                    {"id": "trig", "type": "serviceTask", "name": "触发", "position": {"x": 200, "y": 180},
                     "service": {"impl": "trigger", "triggerType": "IMMEDIATE", "handler": "wfEchoTrigger"}},
                    {"id": "dg", "type": "serviceTask", "name": "委托", "position": {"x": 200, "y": 240},
                     "service": {"impl": "delegate", "delegateExpression": "${myBean}"}},
                    {"id": "join", "type": "inclusiveGateway", "name": "包容汇聚", "position": {"x": 320, "y": 60}},
                    {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 420, "y": 60}}
                  ],
                  "edges": [
                    {"id": "e1", "source": "start", "target": "fork"},
                    {"id": "e2", "source": "fork", "target": "ai"},
                    {"id": "e3", "source": "fork", "target": "wh"},
                    {"id": "e4", "source": "fork", "target": "sc"},
                    {"id": "e5", "source": "fork", "target": "trig"},
                    {"id": "e6", "source": "fork", "target": "dg"},
                    {"id": "e7", "source": "ai", "target": "join"},
                    {"id": "e8", "source": "wh", "target": "join"},
                    {"id": "e9", "source": "sc", "target": "join"},
                    {"id": "e10", "source": "trig", "target": "join"},
                    {"id": "e11", "source": "dg", "target": "join"},
                    {"id": "e12", "source": "join", "target": "end"}
                  ]
                }
                """);
        List<String> warnings = new ArrayList<>();
        ProcessModel pm = roundTrip(graph, warnings);
        assertTrue(warnings.isEmpty(), "无 warning: " + warnings);

        assertEquals("parallelGateway", node(pm, "fork").type);
        assertEquals("inclusiveGateway", node(pm, "join").type);

        assertEquals("ai", node(pm, "ai").type, "wfAiApprovalDelegate→ai");
        assertEquals("gpt-4o", node(pm, "ai").ai.path("model").asString());
        assertEquals("审批", node(pm, "ai").ai.path("systemPrompt").asString());
        assertEquals("days", node(pm, "ai").ai.path("formContext").get(0).asString());

        assertEquals("webhook", node(pm, "wh").type, "wfWebhookDelegate→webhook");
        assertEquals("https://example.com/hook", node(pm, "wh").webhook.path("url").asString());

        FlowNodeDto sc = node(pm, "sc");
        assertEquals("script", sc.service.path("impl").asString());
        assertEquals("groovy", sc.script.path("lang").asString());
        assertTrue(sc.script.path("code").asString().contains("vars.put"), "脚本体回读");

        FlowNodeDto trig = node(pm, "trig");
        assertEquals("trigger", trig.service.path("impl").asString());
        assertEquals("IMMEDIATE", trig.service.path("triggerType").asString());
        assertEquals("wfEchoTrigger", trig.service.path("handler").asString());

        FlowNodeDto dg = node(pm, "dg");
        assertEquals("delegate", dg.service.path("impl").asString());
        assertEquals("${myBean}", dg.service.path("delegateExpression").asString());
    }

    /** callActivity / timerCatch / timerBoundary 往返（正向支持、逆向镜像还原）。 */
    @Test
    void callActivityAndTimersRoundTrip() {
        JsonNode graph = json("""
                {
                  "key": "p", "name": "定时与子流程",
                  "nodes": [
                    {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 60}},
                    {"id": "call", "type": "callActivity", "name": "外部审批", "position": {"x": 100, "y": 60},
                     "callActivity": {"calledElement": "leave_approval", "inheritVariables": true,
                                      "paramMap": [{"child": "subDays", "parent": "days"}]}},
                    {"id": "td", "type": "timerCatch", "name": "等5秒", "position": {"x": 220, "y": 60},
                     "timer": {"mode": "duration", "value": "PT5S"}},
                    {"id": "tb", "type": "timerBoundary", "name": "超时", "position": {"x": 140, "y": 110},
                     "attachedTo": "call", "cancelActivity": false, "timer": {"mode": "cycle", "value": "R/PT30M"}},
                    {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 340, "y": 60}},
                    {"id": "esc", "type": "endEvent", "name": "超时结束", "position": {"x": 340, "y": 160}}
                  ],
                  "edges": [
                    {"id": "e1", "source": "start", "target": "call"},
                    {"id": "e2", "source": "call", "target": "td"},
                    {"id": "e3", "source": "td", "target": "end"},
                    {"id": "e4", "source": "tb", "target": "esc"}
                  ]
                }
                """);
        List<String> warnings = new ArrayList<>();
        ProcessModel pm = roundTrip(graph, warnings);
        assertTrue(warnings.isEmpty(), "无 warning: " + warnings);

        FlowNodeDto call = node(pm, "call");
        assertEquals("callActivity", call.type);
        assertEquals("leave_approval", call.callActivity.path("calledElement").asString());
        assertEquals("subDays", call.callActivity.path("paramMap").get(0).path("child").asString());
        assertEquals("days", call.callActivity.path("paramMap").get(0).path("parent").asString());

        FlowNodeDto td = node(pm, "td");
        assertEquals("timerCatch", td.type);
        assertEquals("duration", td.timer.path("mode").asString());
        assertEquals("PT5S", td.timer.path("value").asString());

        FlowNodeDto tb = node(pm, "tb");
        assertEquals("timerBoundary", tb.type);
        assertEquals("call", tb.attachedTo, "attachedTo 宿主回读");
        assertTrue(Boolean.FALSE.equals(tb.cancelActivity), "非中断型 cancelActivity=false 回读");
        assertEquals("cycle", tb.timer.path("mode").asString());
        assertEquals("R/PT30M", tb.timer.path("value").asString());
    }

    /** 嵌入式 subProcess 递归还原为 children 子图。 */
    @Test
    void embeddedSubProcessRoundTrip() {
        JsonNode graph = json("""
                {
                  "key": "p", "name": "嵌入子流程",
                  "nodes": [
                    {"id": "start", "type": "startEvent", "name": "开始", "position": {"x": 0, "y": 60}},
                    {"id": "sp", "type": "subProcess", "name": "内部", "position": {"x": 100, "y": 60},
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
                    {"id": "end", "type": "endEvent", "name": "结束", "position": {"x": 460, "y": 60}}
                  ],
                  "edges": [
                    {"id": "e1", "source": "start", "target": "sp"},
                    {"id": "e2", "source": "sp", "target": "end"}
                  ]
                }
                """);
        List<String> warnings = new ArrayList<>();
        ProcessModel pm = roundTrip(graph, warnings);
        assertTrue(warnings.isEmpty(), "无 warning: " + warnings);

        FlowNodeDto sp = node(pm, "sp");
        assertEquals("subProcess", sp.type);
        assertNotNull(sp.children, "递归还原 children 子图");
        assertEquals(3, sp.children.nodes.size(), "子图 3 节点");
        assertEquals(2, sp.children.edges.size(), "子图 2 边");
        assertEquals("userTask", sp.children.nodes.stream()
                .filter(n -> "sTask".equals(n.id)).findFirst().orElseThrow().type);
        assertNotNull(sp.size, "subProcess 尺寸从 DI 还原");
        assertEquals(300.0, sp.size.w, 0.001);
    }

    /** 手写 .bpmn（无 oa: 扩展 / 无 DI）：raw UEL 原样进 expression + 缺 DI 兜底坐标 + 自动布局 warning。 */
    @Test
    void plainExternalBpmnFallsBackAndWarns() {
        String xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                             xmlns:flowable="http://flowable.org/bpmn"
                             targetNamespace="http://oa">
                  <process id="plain" name="外部流程">
                    <startEvent id="s"/>
                    <exclusiveGateway id="g"/>
                    <userTask id="u" name="审批" flowable:assignee="${assignee}"/>
                    <endEvent id="e"/>
                    <sequenceFlow id="f1" sourceRef="s" targetRef="g"/>
                    <sequenceFlow id="f2" sourceRef="g" targetRef="u">
                      <conditionExpression xsi:type="tFormalExpression">${amount &gt; 1000}</conditionExpression>
                    </sequenceFlow>
                    <sequenceFlow id="f3" sourceRef="u" targetRef="e"/>
                  </process>
                </definitions>
                """;
        List<String> warnings = new ArrayList<>();
        ProcessModel pm = reverse.importXml(xml, warnings);

        assertEquals("plain", pm.key);
        assertEquals(4, pm.nodes.size());
        assertEquals("userTask", node(pm, "u").type);
        // 无 oa:condition 的手写 UEL → 原样进 expression（不反解结构化）
        SequenceFlowDto f2 = edge(pm, "f2");
        assertEquals("${amount > 1000}", f2.expression, "手写 UEL 原样进 expression");
        assertNull(f2.condition);
        // 缺 DI → 兜底坐标 + 自动布局提示
        assertNotNull(node(pm, "s").position, "缺 DI 仍给兜底坐标");
        assertTrue(warnings.stream().anyMatch(w -> w.contains("自动布局")), "缺 DI 提示前端自动布局: " + warnings);
    }
}
