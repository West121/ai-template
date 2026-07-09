package com.xingchen.oa.workflow.convert;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.convert.graph.FlowNodeDto;
import com.xingchen.oa.workflow.convert.graph.Point;
import com.xingchen.oa.workflow.convert.graph.ProcessModel;
import com.xingchen.oa.workflow.convert.graph.SequenceFlowDto;
import org.flowable.bpmn.model.BaseElement;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.EndEvent;
import org.flowable.bpmn.model.ExclusiveGateway;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.FlowNode;
import org.flowable.bpmn.model.FlowableListener;
import org.flowable.bpmn.model.Gateway;
import org.flowable.bpmn.model.GraphicInfo;
import org.flowable.bpmn.model.ImplementationType;
import org.flowable.bpmn.model.MultiInstanceLoopCharacteristics;
import org.flowable.bpmn.model.Process;
import org.flowable.bpmn.model.SequenceFlow;
import org.flowable.bpmn.model.StartEvent;
import org.flowable.bpmn.model.TerminateEventDefinition;
import org.flowable.bpmn.model.UserTask;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.NullNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 图直译：前端归一化 {@link ProcessModel} JSON（显式 nodes[] + edges[]，含坐标）→ 可部署 Flowable {@link BpmnModel}。
 *
 * <p>定位（附录 C.5）：与旧 {@link JsonToBpmnConverter}（消费嵌套树、自行合成 start/end/网关/顺序流 + {@code autoLayout()}）
 * <b>并存不替换</b>。旧钉钉设计器 + 现有 smoke 继续走旧路径；新 react-flow 设计器走本图直译路径。
 *
 * <p>切片 1（N-B-01）只做核心节点类型：
 * <ul>
 *   <li>{@code startEvent} / {@code endEvent}（含 {@code terminate:true} 终止型，加 TerminateEventDefinition）</li>
 *   <li>{@code userTask}（审批，消费 {@code props: WfNodeProps} → oa: 扩展元素 + {@code ${assignee}} 多实例，
 *       逻辑照搬旧转换器 approval 节点，仅取值来源改为 props）</li>
 *   <li>{@code exclusiveGateway}</li>
 *   <li>{@code sequenceFlow}：{@code condition} 结构化走 {@link ConditionCompiler}→UEL（红线不变）；
 *       {@code isDefault} 默认分支；{@code expression} 高级公式原样写入（与 condition 互斥，附录 C.4）</li>
 * </ul>
 * 并<b>消费前端坐标</b>（position/size/waypoints）生成 BPMN DI，替代旧 {@code autoLayout()}。
 *
 * <p>切片 2 待办（本类遇到时抛清晰「暂不支持」异常）：parallelGateway / inclusiveGateway / subProcess /
 * timerCatch / timerBoundary / callActivity / 通用 serviceTask / cc / ai / webhook / .bpmn 导入导出端点。
 */
@Component
public class GraphToBpmnConverter {

    public static final String OA_NS = "http://oa/bpmn";
    public static final String OA_PREFIX = "oa";

    /**
     * 前端 {@code ConditionOperator}（eq/ne/gt/gte/lt/lte）→ UEL 符号，镜像前端 {@code serde.ts#OP_UEL}。
     * {@code ConditionCompiler} 的 OPS 白名单收的是符号形（== != &gt; &gt;= &lt; &lt;=），
     * 故图直译路径在喂给编译器前先把运算符名映射为符号，UEL 产物与前端 {@code compileUel} 字节一致。
     * contains/notContains 由 ConditionCompiler 直接识别，透传不映射。
     */
    private static final Map<String, String> OP_SYMBOL = Map.of(
            "eq", "==", "ne", "!=", "gt", ">", "gte", ">=", "lt", "<", "lte", "<=");

    private final ObjectMapper mapper;

    public GraphToBpmnConverter(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    /** JSON 入口：反序列化为 {@link ProcessModel} 后直译（复用现有 Jackson）。 */
    public BpmnModel graphToBpmn(JsonNode root) {
        if (root == null || root.isMissingNode() || root.isNull()) {
            throw new BusinessException(400, "ProcessModel JSON 为空");
        }
        ProcessModel model = mapper.treeToValue(root, ProcessModel.class);
        return graphToBpmn(model);
    }

    /** 主入口：归一化 {@link ProcessModel} → 可部署 {@link BpmnModel}。 */
    public BpmnModel graphToBpmn(ProcessModel pm) {
        if (pm == null) {
            throw new BusinessException(400, "ProcessModel 为空");
        }
        if (!StringUtils.hasText(pm.key)) {
            throw new BusinessException(400, "ProcessModel 缺少 key");
        }
        if (pm.nodes == null || pm.nodes.isEmpty()) {
            throw new BusinessException(400, "ProcessModel 缺少 nodes");
        }
        return new Builder(pm).build();
    }

    private final class Builder {
        private final ProcessModel pm;
        private final Process process = new Process();
        private final BpmnModel model = new BpmnModel();

        Builder(ProcessModel pm) {
            this.pm = pm;
        }

        BpmnModel build() {
            model.getNamespaces().put(OA_PREFIX, OA_NS);
            process.setId(JsonToBpmnConverter.sanitizeId(pm.key));
            process.setName(pm.name);
            addExt(process, "flowConfig", pm.flowConfig);
            model.addProcess(process);

            // 1) 节点：一等 start/end/userTask/exclusiveGateway 直译（不合成拓扑）
            for (FlowNodeDto node : pm.nodes) {
                buildNode(node);
            }
            // 2) 连线：显式 edge → sequenceFlow（条件二源 + 默认分支）
            List<SequenceFlowDto> edges = pm.edges == null ? List.of() : pm.edges;
            for (SequenceFlowDto edge : edges) {
                buildEdge(edge);
            }
            // 3) 消费前端坐标生成 BPMN DI（替代 autoLayout）
            buildDi(edges);
            return model;
        }

        private void buildNode(FlowNodeDto node) {
            String type = node.type == null ? "" : node.type;
            switch (type) {
                case "startEvent" -> startEvent(node);
                case "endEvent" -> endEvent(node);
                case "userTask" -> userTask(node);
                case "exclusiveGateway" -> exclusiveGateway(node);
                case "serviceTask", "parallelGateway", "inclusiveGateway", "callActivity",
                     "subProcess", "timerCatch", "timerBoundary", "cc", "ai", "webhook" ->
                        throw new BusinessException(400, "图直译暂不支持节点类型(切片 2 补齐): " + type);
                default -> throw new BusinessException(400, "未知流程节点类型: " + type);
            }
        }

        private void startEvent(FlowNodeDto node) {
            StartEvent start = new StartEvent();
            start.setId(nid(node));
            start.setName(name(node, "开始"));
            process.addFlowElement(start);
        }

        private void endEvent(FlowNodeDto node) {
            EndEvent end = new EndEvent();
            end.setId(nid(node));
            end.setName(name(node, "结束"));
            if (Boolean.TRUE.equals(node.terminate)) {
                end.addEventDefinition(new TerminateEventDefinition());
            }
            process.addFlowElement(end);
        }

        private void exclusiveGateway(FlowNodeDto node) {
            ExclusiveGateway gw = new ExclusiveGateway();
            gw.setId(nid(node));
            gw.setName(name(node, "网关"));
            process.addFlowElement(gw);
        }

        /**
         * 审批用户任务：逻辑照搬旧 {@code JsonToBpmnConverter#approval}，仅把取值来源从节点顶层字段
         * 改为 {@code node.props}（WfNodeProps）。扩展元素名保持一致（assigneeRules/emptyStrategy/…），
         * 运行时由 {@code wfAssigneeResolver}/{@code wfVote}/{@code wfEventDelegate} 等 bean 读取。
         */
        private void userTask(FlowNodeDto node) {
            String nid = nid(node);
            JsonNode props = node.props == null ? NullNode.getInstance() : node.props;

            UserTask task = new UserTask();
            task.setId(nid);
            task.setName(name(node, "审批"));
            String fk = StringUtils.hasText(node.formKey) ? node.formKey : pm.formKey;
            if (StringUtils.hasText(fk)) {
                task.setFormKey(fk);
            }
            addExt(task, "assigneeRules", props.path("assigneeRules"));
            addExtText(task, "emptyStrategy", props.path("emptyStrategy").asString("AUTO_PASS"));
            addExt(task, "allowedOps", props.path("allowedOps"));
            addExt(task, "handleOptions", props.path("handleOptions"));
            addExt(task, "timeout", props.path("timeout"));
            addExt(task, "formPerms", props.path("formPerms"));
            addExt(task, "auditMenu", props.path("auditMenu"));
            addExt(task, "commentRequired", props.path("commentRequired"));
            addNodeEvents(task, props.path("events"));

            // 办理选项 candidate=true 等价分组认领（旧路径另读 node.groupMode，WfNodeProps 无该字段，故仅认 candidate）
            boolean candidate = props.path("handleOptions").path("candidate").asBoolean(false);
            if (candidate) {
                task.setCandidateUsers(List.of(
                        "${wfAssigneeResolver.resolveCsv(execution,'" + nid + "')}"));
                addExtText(task, "groupMode", "CLAIM");
                process.addFlowElement(task);
                return;
            }

            task.setAssignee("${assignee}");
            String multiMode = props.path("multiMode").asString("ANY");
            MultiInstanceLoopCharacteristics mi = new MultiInstanceLoopCharacteristics();
            mi.setInputDataItem("${wfAssigneeResolver.resolve(execution,'" + nid + "')}");
            mi.setElementVariable("assignee");
            switch (multiMode.toUpperCase()) {
                case "SEQUENCE" -> mi.setSequential(true);
                case "ALL" -> mi.setSequential(false);
                case "VOTE" -> {
                    mi.setSequential(false);
                    mi.setCompletionCondition("${wfVote.pass(execution)}");
                    addExt(task, "voteConfig", props.path("voteConfig"));
                }
                default -> {
                    mi.setSequential(false);
                    mi.setCompletionCondition("${nrOfCompletedInstances > 0}");
                }
            }
            task.setLoopCharacteristics(mi);
            addExtText(task, "multiMode", multiMode);
            process.addFlowElement(task);
        }

        private void buildEdge(SequenceFlowDto edge) {
            if (!StringUtils.hasText(edge.source) || !StringUtils.hasText(edge.target)) {
                throw new BusinessException(400, "连线缺少 source/target");
            }
            String src = JsonToBpmnConverter.sanitizeId(edge.source);
            String tgt = JsonToBpmnConverter.sanitizeId(edge.target);
            String eid = StringUtils.hasText(edge.id) ? JsonToBpmnConverter.sanitizeId(edge.id) : ("flow_" + src + "_" + tgt);

            SequenceFlow flow = new SequenceFlow(src, tgt);
            flow.setId(eid);
            if (StringUtils.hasText(edge.name)) {
                flow.setName(edge.name);
            }

            boolean isDefault = Boolean.TRUE.equals(edge.isDefault);
            boolean hasExpr = StringUtils.hasText(edge.expression);
            boolean hasCond = edge.condition != null && !edge.condition.isMissingNode() && !edge.condition.isNull()
                    && edge.condition.path("items").isArray() && !edge.condition.path("items").isEmpty();

            if (isDefault) {
                // 默认分支：网关 default 的唯一真相源，本身不带条件
                FlowElement s = process.getFlowElement(src);
                if (s instanceof Gateway g) {
                    g.setDefaultFlow(eid);
                } else {
                    throw new BusinessException(400, "isDefault 默认分支的 source 必须是网关: " + edge.source);
                }
            } else if (hasExpr && hasCond) {
                throw new BusinessException(400, "同一条边 condition 与 expression 互斥(附录 C.4): " + eid);
            } else if (hasExpr) {
                // 高级公式逃生口：原样下发为条件表达式
                flow.setConditionExpression(edge.expression);
            } else if (hasCond) {
                // 结构化条件：ConditionCompiler 编译 UEL（红线不变）+ 存 oa:condition 供回编辑
                String uel = compileCondition(edge.condition);
                if (StringUtils.hasText(uel)) {
                    flow.setConditionExpression(uel);
                }
                addExtText(flow, "condition", edge.condition.toString());
            }
            process.addFlowElement(flow);
        }

        /**
         * 结构化 {@code BranchCondition}（logic + items[]，运算符为前端 ConditionOperator 名）
         * → 映射运算符符号后交 {@link ConditionCompiler} 编译 UEL。红线：不改 ConditionCompiler 的编译规则。
         */
        private String compileCondition(JsonNode condition) {
            ArrayNode conditions = mapper.createArrayNode();
            for (JsonNode item : condition.path("items")) {
                ObjectNode o = mapper.createObjectNode();
                o.set("field", item.path("field"));
                String op = item.path("operator").asString("");
                o.put("operator", OP_SYMBOL.getOrDefault(op, op));
                JsonNode value = item.get("value");
                o.set("value", value == null ? NullNode.getInstance() : value);
                conditions.add(o);
            }
            String logic = condition.path("logic").asString("AND");
            return ConditionCompiler.compile(conditions, logic);
        }

        /* ---------------- BPMN DI：消费前端坐标（position/size/waypoints） ---------------- */

        private void buildDi(List<SequenceFlowDto> edges) {
            for (FlowElement el : process.getFlowElements()) {
                if (el instanceof FlowNode fn) {
                    FlowNodeDto dto = findNode(fn.getId());
                    double[] wh = sizeOf(fn, dto);
                    GraphicInfo gi = new GraphicInfo();
                    gi.setWidth(wh[0]);
                    gi.setHeight(wh[1]);
                    gi.setX(dto != null && dto.position != null ? dto.position.x : 0);
                    gi.setY(dto != null && dto.position != null ? dto.position.y : 0);
                    model.addGraphicInfo(fn.getId(), gi);
                }
            }
            for (SequenceFlowDto edge : edges) {
                String eid = StringUtils.hasText(edge.id)
                        ? JsonToBpmnConverter.sanitizeId(edge.id)
                        : ("flow_" + JsonToBpmnConverter.sanitizeId(edge.source) + "_" + JsonToBpmnConverter.sanitizeId(edge.target));
                List<GraphicInfo> way = new ArrayList<>();
                if (edge.waypoints != null && !edge.waypoints.isEmpty()) {
                    for (Point p : edge.waypoints) {
                        way.add(new GraphicInfo(p.x, p.y));
                    }
                } else {
                    // 缺省 waypoints：源右中 → 目标左中兜底
                    GraphicInfo s = model.getGraphicInfo(JsonToBpmnConverter.sanitizeId(edge.source));
                    GraphicInfo t = model.getGraphicInfo(JsonToBpmnConverter.sanitizeId(edge.target));
                    if (s == null || t == null) {
                        continue;
                    }
                    way.add(new GraphicInfo(s.getX() + s.getWidth(), s.getY() + s.getHeight() / 2));
                    way.add(new GraphicInfo(t.getX(), t.getY() + t.getHeight() / 2));
                }
                model.addFlowGraphicInfoList(eid, way);
            }
        }

        private FlowNodeDto findNode(String sanitizedId) {
            for (FlowNodeDto n : pm.nodes) {
                if (JsonToBpmnConverter.sanitizeId(n.id).equals(sanitizedId)) {
                    return n;
                }
            }
            return null;
        }

        /** 节点尺寸：优先前端 size；否则事件 30×30 / 网关 40×40 / 任务 100×60 */
        private double[] sizeOf(FlowNode fn, FlowNodeDto dto) {
            if (dto != null && dto.size != null && dto.size.w > 0 && dto.size.h > 0) {
                return new double[]{dto.size.w, dto.size.h};
            }
            if (fn instanceof StartEvent || fn instanceof EndEvent) {
                return new double[]{30, 30};
            }
            if (fn instanceof Gateway) {
                return new double[]{40, 40};
            }
            return new double[]{100, 60};
        }

        /* ---------------- 扩展元素 / 事件助手（与旧转换器写法一致，供 delegate bean 读取） ---------------- */

        private void addNodeEvents(UserTask task, JsonNode events) {
            if (events == null || !events.isArray() || events.isEmpty()) {
                return;
            }
            addExtText(task, "events", events.toString());
            Set<String> listenerEvents = new LinkedHashSet<>();
            for (JsonNode ev : events) {
                String le = taskListenerEventFor(ev.path("trigger").asString(""));
                if (le != null) {
                    listenerEvents.add(le);
                }
            }
            for (String le : listenerEvents) {
                FlowableListener l = new FlowableListener();
                l.setEvent(le);
                l.setImplementationType(ImplementationType.IMPLEMENTATION_TYPE_DELEGATEEXPRESSION);
                l.setImplementation("${wfEventDelegate}");
                task.getTaskListeners().add(l);
            }
        }

        private String taskListenerEventFor(String trigger) {
            return switch (trigger) {
                case "TASK_AFTER_CREATED", "ACTIVITY_CONFIRM_PARTICIPANTS" -> "create";
                case "TASK_BEFORE_COMPLETE", "TASK_AFTER_COMPLETE" -> "complete";
                case "TASK_BEFORE_UNDO", "TASK_AFTER_UNDO" -> "delete";
                default -> null;
            };
        }

        private void addExt(BaseElement el, String extName, JsonNode value) {
            if (value == null || value.isMissingNode() || value.isNull()) {
                return;
            }
            addExtText(el, extName, value.toString());
        }

        private void addExtText(BaseElement el, String extName, String text) {
            if (!StringUtils.hasText(text)) {
                return;
            }
            ExtensionElement ee = new ExtensionElement();
            ee.setName(extName);
            ee.setNamespacePrefix(OA_PREFIX);
            ee.setNamespace(OA_NS);
            ee.setElementText(text);
            el.addExtensionElement(ee);
        }

        private String nid(FlowNodeDto node) {
            if (!StringUtils.hasText(node.id)) {
                throw new BusinessException(400, "节点缺少 id: type=" + node.type);
            }
            return JsonToBpmnConverter.sanitizeId(node.id);
        }

        private String name(FlowNodeDto node, String fallback) {
            return StringUtils.hasText(node.name) ? node.name : fallback;
        }
    }
}
