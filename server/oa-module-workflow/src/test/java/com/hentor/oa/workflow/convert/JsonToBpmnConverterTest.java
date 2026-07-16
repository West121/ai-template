package com.hentor.oa.workflow.convert;

import com.hentor.oa.common.exception.BusinessException;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.ExclusiveGateway;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.MultiInstanceLoopCharacteristics;
import org.flowable.bpmn.model.Process;
import org.flowable.bpmn.model.SequenceFlow;
import org.flowable.bpmn.model.ServiceTask;
import org.flowable.bpmn.model.UserTask;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JsonToBpmnConverterTest {

    private final JsonToBpmnConverter converter = new JsonToBpmnConverter();
    private final JsonMapper mapper = JsonMapper.builder().build();

    private JsonNode json(String s) {
        return mapper.readTree(s);
    }

    private Process process(BpmnModel model) {
        return model.getMainProcess();
    }

    @Test
    void approvalAnyBecomesParallelMultiInstanceWithCompletionCondition() {
        JsonNode root = json("""
                {"nodes":[{"id":"mgr","type":"approval","name":"部门经理审批",
                  "assigneeRules":[{"type":"LEADER","level":1}],"multiMode":"ANY","emptyStrategy":"TO_ADMIN"}]}
                """);
        BpmnModel model = converter.convert("leave", "请假", "leave:1", root);
        UserTask task = (UserTask) process(model).getFlowElement("mgr");
        assertNotNull(task);
        assertEquals("${assignee}", task.getAssignee());
        MultiInstanceLoopCharacteristics mi = task.getLoopCharacteristics();
        assertNotNull(mi, "审批节点应生成多实例");
        assertFalse(mi.isSequential(), "ANY 为并行多实例");
        assertEquals("assignee", mi.getElementVariable());
        assertTrue(mi.getInputDataItem().contains("wfAssigneeResolver.resolve"), "collection 走审批人求值 bean");
        assertTrue(mi.getCompletionCondition().contains("nrOfCompletedInstances > 0"), "或签一票完成");
        // 扩展元素落库
        assertNotNull(task.getExtensionElements().get("assigneeRules"));
        assertNotNull(task.getExtensionElements().get("emptyStrategy"));
        assertEquals("leave:1", task.getFormKey());
    }

    @Test
    void sequenceModeBecomesSequentialMultiInstance() {
        JsonNode root = json("""
                {"nodes":[{"id":"n1","type":"approval","name":"会签","multiMode":"SEQUENCE",
                  "assigneeRules":[{"type":"INITIATOR"}]}]}
                """);
        BpmnModel model = converter.convert("p", "p", null, root);
        UserTask task = (UserTask) process(model).getFlowElement("n1");
        assertTrue(task.getLoopCharacteristics().isSequential(), "SEQUENCE 为串行多实例");
        assertNull(task.getLoopCharacteristics().getCompletionCondition(), "顺序会签需全部完成");
    }

    @Test
    void allModeParallelWithoutCompletionCondition() {
        JsonNode root = json("""
                {"nodes":[{"id":"n1","type":"approval","name":"并行会签","multiMode":"ALL",
                  "assigneeRules":[{"type":"INITIATOR"}]}]}
                """);
        UserTask task = (UserTask) process(converter.convert("p", "p", null, root)).getFlowElement("n1");
        assertFalse(task.getLoopCharacteristics().isSequential());
        assertNull(task.getLoopCharacteristics().getCompletionCondition(), "会签默认全部完成");
    }

    @Test
    void conditionBecomesExclusiveGatewayWithCompiledUelAndDefaultFlow() {
        JsonNode root = json("""
                {"nodes":[{"id":"cond","type":"condition","name":"天数判断","branches":[
                   {"id":"b1","name":">3","conditions":[{"field":"days","operator":">","value":3}],
                    "steps":[{"id":"gm","type":"approval","name":"总经理","assigneeRules":[{"type":"INITIATOR"}]}]},
                   {"id":"b0","name":"默认","default":true,"steps":[]}]}]}
                """);
        BpmnModel model = converter.convert("p", "p", null, root);
        Process p = process(model);
        ExclusiveGateway split = (ExclusiveGateway) p.getFlowElement("cond_split");
        assertNotNull(split, "条件节点生成排它网关");
        assertNotNull(split.getDefaultFlow(), "存在默认分支");
        assertNotNull(p.getFlowElement("gm"), "分支内审批节点生成");
        // 条件流带编译后的 UEL
        boolean hasUel = p.getFlowElements().stream()
                .filter(e -> e instanceof SequenceFlow)
                .map(e -> ((SequenceFlow) e).getConditionExpression())
                .filter(c -> c != null)
                .anyMatch(c -> c.replace(" ", "").equals("${days>3}"));
        assertTrue(hasUel, "结构化条件编译为 ${days > 3}");
    }

    @Test
    void ccNodeBecomesServiceTaskDelegate() {
        JsonNode root = json("""
                {"nodes":[{"id":"cc1","type":"cc","name":"抄送","users":[{"username":"zhangsan"}]}]}
                """);
        ServiceTask st = (ServiceTask) process(converter.convert("p", "p", null, root)).getFlowElement("cc1");
        assertNotNull(st);
        assertEquals("${wfCcDelegate}", st.getImplementation());
        assertNotNull(st.getExtensionElements().get("ccUsers"));
    }

    @Test
    void startAndEndEventsWiredForFullGraph() {
        JsonNode root = json("""
                {"nodes":[
                  {"id":"mgr","type":"approval","name":"经理","assigneeRules":[{"type":"LEADER","level":1}],"multiMode":"ANY"},
                  {"id":"cc1","type":"cc","name":"抄送","users":[]}]}
                """);
        Process p = process(converter.convert("p", "p", null, root));
        assertNotNull(p.getFlowElement("start"));
        assertNotNull(p.getFlowElement("end"));
        // start 必然有一条出边
        List<FlowElement> flows = p.getFlowElements().stream()
                .filter(e -> e instanceof SequenceFlow && ((SequenceFlow) e).getSourceRef().equals("start"))
                .toList();
        assertEquals(1, flows.size());
    }

    @Test
    void generatesBpmnDiForEveryFlowNode() {
        JsonNode root = json("""
                {"nodes":[
                  {"id":"mgr","type":"approval","name":"经理","assigneeRules":[{"type":"LEADER","level":1}],"multiMode":"ANY"},
                  {"id":"cond","type":"condition","name":"天数","branches":[
                     {"id":"b1","name":">3","conditions":[{"field":"days","operator":">","value":3}],
                      "steps":[{"id":"gm","type":"approval","name":"总经理","assigneeRules":[{"type":"INITIATOR"}]}]},
                     {"id":"b0","name":"默认","default":true,"steps":[]}]},
                  {"id":"cc1","type":"cc","name":"抄送","users":[]}]}
                """);
        BpmnModel model = converter.convert("p", "p", null, root);
        Process p = process(model);
        long flowNodeCount = p.getFlowElements().stream()
                .filter(e -> !(e instanceof SequenceFlow)).count();
        // 每个流程节点都有 BPMNShape（GraphicInfo）
        assertEquals(flowNodeCount, model.getLocationMap().size(), "每个节点都应有 DI 图形坐标");
        assertTrue(model.getLocationMap().containsKey("start"));
        assertTrue(model.getLocationMap().containsKey("mgr"));
        assertTrue(model.getLocationMap().containsKey("cond_split"));
        assertTrue(model.getLocationMap().containsKey("end"));
        // 每条 sequenceFlow 都有 BPMNEdge（waypoints）
        long flowCount = p.getFlowElements().stream().filter(e -> e instanceof SequenceFlow).count();
        assertEquals(flowCount, model.getFlowLocationMap().size(), "每条连线都应有 DI 路径点");
        model.getLocationMap().values().forEach(gi -> {
            assertTrue(gi.getWidth() > 0 && gi.getHeight() > 0, "节点需有正的宽高");
        });
    }

    @Test
    void multiConditionAndByDefault() {
        JsonNode conditions = json("[{\"field\":\"amount\",\"operator\":\">\",\"value\":1000},{\"field\":\"urgent\",\"operator\":\"==\",\"value\":true}]");
        assertEquals("${amount > 1000 && urgent == true}", ConditionCompiler.compile(conditions));
    }

    @Test
    void multiConditionOrLogic() {
        JsonNode conditions = json("[{\"field\":\"amount\",\"operator\":\">\",\"value\":1000},{\"field\":\"urgent\",\"operator\":\"==\",\"value\":true}]");
        assertEquals("${amount > 1000 || urgent == true}", ConditionCompiler.compile(conditions, "OR"));
        // 大小写不敏感
        assertEquals("${amount > 1000 || urgent == true}", ConditionCompiler.compile(conditions, "or"));
    }

    @Test
    void orLogicInConditionBranchCompilesToDoublePipe() {
        JsonNode root = json("""
                {"nodes":[{"id":"cond","type":"condition","name":"OR","branches":[
                   {"id":"b1","name":"大额或加急","logic":"OR",
                    "conditions":[{"field":"amount","operator":">","value":1000},{"field":"urgent","operator":"==","value":true}],
                    "steps":[{"id":"ap","type":"approval","name":"复核","assigneeRules":[{"type":"INITIATOR"}]}]},
                   {"id":"b0","name":"默认","default":true,"steps":[]}]}]}
                """);
        Process p = process(converter.convert("p", "p", null, root));
        boolean hasOr = p.getFlowElements().stream()
                .filter(e -> e instanceof SequenceFlow)
                .map(e -> ((SequenceFlow) e).getConditionExpression())
                .filter(c -> c != null)
                .anyMatch(c -> c.contains("||"));
        assertTrue(hasOr, "OR 分支应编译出 || 连接的 UEL");
    }

    @Test
    void unsupportedOperatorRejected() {
        JsonNode conditions = json("[{\"field\":\"days\",\"operator\":\"DROP\",\"value\":3}]");
        assertThrows(BusinessException.class, () -> ConditionCompiler.compile(conditions));
    }

    @Test
    void illegalFieldRejected() {
        JsonNode conditions = json("[{\"field\":\"days; DROP TABLE\",\"operator\":\">\",\"value\":3}]");
        assertThrows(BusinessException.class, () -> ConditionCompiler.compile(conditions));
    }
}
