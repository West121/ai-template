package com.hentor.oa.workflow.convert;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.workflow.convert.graph.FlowNodeDto;
import com.hentor.oa.workflow.convert.graph.Point;
import com.hentor.oa.workflow.convert.graph.ProcessModel;
import com.hentor.oa.workflow.convert.graph.SequenceFlowDto;
import com.hentor.oa.workflow.convert.graph.Size;
import org.flowable.bpmn.converter.BpmnXMLConverter;
import org.flowable.bpmn.model.BaseElement;
import org.flowable.bpmn.model.BoundaryEvent;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.CallActivity;
import org.flowable.bpmn.model.EndEvent;
import org.flowable.bpmn.model.EventDefinition;
import org.flowable.bpmn.model.ExclusiveGateway;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.FlowElementsContainer;
import org.flowable.bpmn.model.Gateway;
import org.flowable.bpmn.model.GraphicInfo;
import org.flowable.bpmn.model.IOParameter;
import org.flowable.bpmn.model.InclusiveGateway;
import org.flowable.bpmn.model.IntermediateCatchEvent;
import org.flowable.bpmn.model.ParallelGateway;
import org.flowable.bpmn.model.Process;
import org.flowable.bpmn.model.SequenceFlow;
import org.flowable.bpmn.model.ServiceTask;
import org.flowable.bpmn.model.StartEvent;
import org.flowable.bpmn.model.SubProcess;
import org.flowable.bpmn.model.TerminateEventDefinition;
import org.flowable.bpmn.model.TimerEventDefinition;
import org.flowable.bpmn.model.UserTask;
import org.flowable.common.engine.api.io.InputStreamProvider;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.node.StringNode;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 逆向图直译：Flowable {@link BpmnModel} → 前端归一化 {@link ProcessModel}（{@link GraphToBpmnConverter} 的逆）。
 *
 * <p>用途（N-B-02，附录 B「.bpmn 往返」）：{@code POST /api/wf/models/import} 上传/贴入标准 {@code .bpmn} XML
 * → Flowable {@code BpmnXMLConverter.convertToBpmnModel} 得 {@link BpmnModel} → 本转换器还原为 {@link ProcessModel}
 * JSON 供前端 react-flow 载入（fromProcessModel）。与正向 {@link GraphToBpmnConverter} 保持<b>往返自洽</b>：
 * {@code ProcessModel → BpmnModel →(存 xml)→ BpmnModel → ProcessModel} 对核心类型结构等价（id/类型/条件/坐标）。
 *
 * <p><b>本切片覆盖的核心类型</b>（与正向逐一镜像）：
 * <ul>
 *   <li>{@code startEvent} / {@code endEvent}（含 {@code terminate:true}，读回 TerminateEventDefinition）</li>
 *   <li>{@code userTask}：读 {@code oa:} 扩展元素回 {@code props}（WfNodeProps：assigneeRules/emptyStrategy/multiMode/
 *       voteConfig/allowedOps/handleOptions/timeout/formPerms/auditMenu/commentRequired/events）+ formKey</li>
 *   <li>{@code serviceTask}：按 delegateExpression 反查 impl——{@code wfAutoDecide}→autoApprove/autoReject（读 autoDecision）、
 *       {@code wfTriggerDelegate}→trigger、{@code wfScriptDelegate}→script（读 scriptLang/scriptCode）、其余→delegate</li>
 *   <li>OA 行为一等节点：{@code wfCcDelegate}→{@code cc}（读 props.ccUsers）、{@code wfAiApprovalDelegate}→{@code ai}、
 *       {@code wfWebhookDelegate}→{@code webhook}</li>
 *   <li>{@code exclusiveGateway} / {@code parallelGateway} / {@code inclusiveGateway}</li>
 *   <li>{@code sequenceFlow}：{@code oa:condition} 扩展存在 → 回结构化 {@code condition}（ConditionCompiler 产物，operator
 *       名原样保留）；{@code ${exprEval.evalBoolean(...)}} 包裹 → 解包回 {@code expression}（镜像正向 wrapExprEval）；
 *       其余原始 UEL → 原样进 {@code expression}；网关 default 出边 → {@code isDefault}；DI 路径 → waypoints</li>
 * </ul>
 * <b>坐标</b>从 BPMN DI（BPMNShape/BPMNEdge）读回 position/size/waypoints；某节点无 DI 时给兜底坐标并在结果 warnings
 * 里标注「需前端自动布局」。
 *
 * <p><b>本切片同时还原</b>（正向已支持、逆向机械镜像）：{@code callActivity}（calledElement/inheritVariables/paramMap）、
 * 嵌入式 {@code subProcess}（递归 children 子图）、{@code timerCatch}（intermediateCatchEvent）、{@code timerBoundary}
 * （boundaryEvent，读 attachedTo/cancelActivity/timer）。未建模的其它 BPMN 元素类型 → 记 warning 跳过，不中断整体导入。
 *
 * <p><b>条件逆向的设计取舍（诚实标注）</b>：结构化条件走 {@code oa:condition} 扩展元素回读——正向即把原始
 * {@code BranchCondition}（operator 为 eq/ne/gt… 名形，附录 C.6）存入该扩展「供回编辑」，故逆向无损、且天然处理
 * OR 逻辑 / contains / 字符串转义。<b>不</b>反解 UEL 符号（{@code > → gt}）：反解裸 UEL 无法可靠区分数字/字符串、
 * 还原 logic 与 contains，脆弱且有歧义。没有 {@code oa:condition} 扩展的手写 UEL 一律「原样进 expression」，
 * 与任务「否则原样进 expression」一致。
 */
@Component
public class BpmnToGraphConverter {

    /** 匹配正向 {@code wrapExprEval} 产物：{@code ${exprEval.evalBoolean(execution,'<escaped>')}}。 */
    private static final Pattern EXPR_EVAL = Pattern.compile(
            "^\\$\\{exprEval\\.evalBoolean\\(execution,'(.*)'\\)}$", Pattern.DOTALL);

    /** userTask 的 {@code oa:} 扩展元素 → {@code props}（WfNodeProps）字段名单（engine-only 的 groupMode 不带入，附录 C.8）。 */
    private static final List<String> USER_TASK_PROP_EXTS = List.of(
            "assigneeRules", "emptyStrategy", "multiMode", "voteConfig", "allowedOps",
            "handleOptions", "timeout", "formPerms", "auditMenu", "commentRequired", "events");

    private final ObjectMapper mapper;

    public BpmnToGraphConverter(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    /** XML 入口：标准 {@code .bpmn} XML → {@link ProcessModel}，warnings 收集未完全还原/缺 DI 提示。 */
    public ProcessModel importXml(String xml, List<String> warnings) {
        if (!StringUtils.hasText(xml)) {
            throw new BusinessException(400, ".bpmn XML 为空");
        }
        byte[] bytes = xml.getBytes(StandardCharsets.UTF_8);
        InputStreamProvider provider = () -> new ByteArrayInputStream(bytes);
        BpmnModel model;
        try {
            // validateSchema=false / enableSafeBpmnXml=false（Flowable 默认安全解析，禁 DTD/外部实体由其 XMLInputFactory 处理）
            model = new BpmnXMLConverter().convertToBpmnModel(provider, false, false);
        } catch (Exception ex) {
            throw new BusinessException(400, ".bpmn 解析失败：" + ex.getMessage());
        }
        return bpmnToGraph(model, warnings);
    }

    /** 主入口：{@link BpmnModel} → {@link ProcessModel}。warnings 可传 null（丢弃）。 */
    public ProcessModel bpmnToGraph(BpmnModel model, List<String> warnings) {
        List<String> warn = warnings == null ? new ArrayList<>() : warnings;
        if (model == null) {
            throw new BusinessException(400, "BpmnModel 为空");
        }
        Process process = model.getMainProcess();
        if (process == null) {
            throw new BusinessException(400, ".bpmn 缺少 process 元素");
        }
        ProcessModel pm = new ProcessModel();
        pm.schemaVersion = 1;
        pm.key = process.getId();
        pm.name = process.getName();
        pm.flowConfig = readExtJson(process, "flowConfig");

        Ctx ctx = new Ctx(model, warn);
        SubGraphResult root = readContainer(process, ctx);
        pm.nodes = root.nodes;
        pm.edges = root.edges;
        return pm;
    }

    private record Ctx(BpmnModel model, List<String> warnings) {
        void warnMissingDi() {
            String w = "部分节点缺少 BPMN DI，已使用兜底坐标，建议前端自动布局(elk/dagre)";
            if (!warnings.contains(w)) {
                warnings.add(w);
            }
        }
    }

    private static final class SubGraphResult {
        final List<FlowNodeDto> nodes = new ArrayList<>();
        final List<SequenceFlowDto> edges = new ArrayList<>();
    }

    /** 直译一段容器（顶层 process 或嵌入式 subProcess）→ 扁平 nodes + 显式 edges。 */
    private SubGraphResult readContainer(FlowElementsContainer container, Ctx ctx) {
        SubGraphResult res = new SubGraphResult();
        int idx = 0;
        for (FlowElement el : container.getFlowElements()) {
            if (el instanceof SequenceFlow) {
                continue; // 边最后统一处理，先建全节点
            }
            FlowNodeDto n = readNode(el, container, ctx, idx);
            if (n != null) {
                res.nodes.add(n);
                idx++;
            }
        }
        for (FlowElement el : container.getFlowElements()) {
            if (el instanceof SequenceFlow sf) {
                res.edges.add(readEdge(sf, container, ctx));
            }
        }
        return res;
    }

    private FlowNodeDto readNode(FlowElement el, FlowElementsContainer container, Ctx ctx, int idx) {
        FlowNodeDto n = new FlowNodeDto();
        n.id = el.getId();
        n.name = StringUtils.hasText(el.getName()) ? el.getName() : null;
        setDi(n, el.getId(), ctx, idx);

        if (el instanceof StartEvent) {
            n.type = "startEvent";
        } else if (el instanceof EndEvent end) {
            n.type = "endEvent";
            if (hasTerminate(end)) {
                n.terminate = Boolean.TRUE;
            }
        } else if (el instanceof UserTask ut) {
            n.type = "userTask";
            if (StringUtils.hasText(ut.getFormKey())) {
                n.formKey = ut.getFormKey();
            }
            n.props = readUserTaskProps(ut);
        } else if (el instanceof ServiceTask st) {
            readServiceTask(st, n);
        } else if (el instanceof ExclusiveGateway) {
            n.type = "exclusiveGateway";
        } else if (el instanceof ParallelGateway) {
            n.type = "parallelGateway";
        } else if (el instanceof InclusiveGateway) {
            n.type = "inclusiveGateway";
        } else if (el instanceof CallActivity ca) {
            n.type = "callActivity";
            n.callActivity = readCallActivity(ca);
        } else if (el instanceof SubProcess sp) {
            n.type = "subProcess";
            SubGraphResult child = readContainer(sp, ctx);
            FlowNodeDto.SubGraph sub = new FlowNodeDto.SubGraph();
            sub.nodes = child.nodes;
            sub.edges = child.edges;
            n.children = sub;
        } else if (el instanceof BoundaryEvent be && timerOf(be) != null) {
            n.type = "timerBoundary";
            if (StringUtils.hasText(be.getAttachedToRefId())) {
                n.attachedTo = be.getAttachedToRefId();
            }
            n.cancelActivity = be.isCancelActivity();
            n.timer = readTimer(be);
        } else if (el instanceof IntermediateCatchEvent ice && timerOf(ice) != null) {
            n.type = "timerCatch";
            n.timer = readTimer(ice);
        } else {
            ctx.warnings().add("未还原的 BPMN 元素（本切片未建模），已跳过：id=" + el.getId()
                    + " 类型=" + el.getClass().getSimpleName());
            return null;
        }
        return n;
    }

    /** serviceTask 按 delegateExpression 反查一等节点类型 / serviceTask.impl（镜像正向 delegate bean 名，红线）。 */
    private void readServiceTask(ServiceTask st, FlowNodeDto n) {
        String impl = st.getImplementation() == null ? "" : st.getImplementation();
        switch (impl) {
            case "${wfCcDelegate}" -> {
                n.type = "cc";
                ObjectNode props = mapper.createObjectNode();
                JsonNode ccUsers = readExtJson(st, "ccUsers");
                if (ccUsers != null) {
                    props.set("ccUsers", ccUsers);
                }
                n.props = props;
            }
            case "${wfAiApprovalDelegate}" -> {
                n.type = "ai";
                ObjectNode ai = mapper.createObjectNode();
                putIfText(ai, "model", readExtText(st, "aiModel"));
                putIfText(ai, "systemPrompt", readExtText(st, "aiSystemPrompt"));
                setIfJson(ai, "formContext", readExtJson(st, "aiFormContext"));
                setIfJson(ai, "outputMap", readExtJson(st, "aiOutputMap"));
                n.ai = ai;
            }
            case "${wfWebhookDelegate}" -> {
                n.type = "webhook";
                ObjectNode wh = mapper.createObjectNode();
                putIfText(wh, "url", readExtText(st, "webhookUrl"));
                n.webhook = wh;
            }
            case "${wfAutoDecide}" -> {
                n.type = "serviceTask";
                String decision = readExtText(st, "autoDecision");
                ObjectNode svc = mapper.createObjectNode();
                svc.put("impl", "REJECT".equalsIgnoreCase(decision) ? "autoReject" : "autoApprove");
                n.service = svc;
            }
            case "${wfTriggerDelegate}" -> {
                n.type = "serviceTask";
                ObjectNode svc = mapper.createObjectNode();
                svc.put("impl", "trigger");
                putIfText(svc, "triggerType", readExtText(st, "triggerType"));
                putIfText(svc, "handler", readExtText(st, "triggerHandler"));
                putIfText(svc, "webhookUrl", readExtText(st, "webhookUrl"));
                setIfJson(svc, "config", readExtJson(st, "triggerConfig"));
                putIfText(svc, "timer", readExtText(st, "triggerTimer"));
                n.service = svc;
            }
            case "${wfScriptDelegate}" -> {
                n.type = "serviceTask";
                ObjectNode svc = mapper.createObjectNode();
                svc.put("impl", "script");
                n.service = svc;
                ObjectNode script = mapper.createObjectNode();
                putIfText(script, "lang", readExtText(st, "scriptLang"));
                putIfText(script, "code", readExtText(st, "scriptCode"));
                n.script = script;
            }
            default -> {
                n.type = "serviceTask";
                ObjectNode svc = mapper.createObjectNode();
                svc.put("impl", "delegate");
                if (StringUtils.hasText(impl)) {
                    svc.put("delegateExpression", impl);
                }
                n.service = svc;
            }
        }
    }

    private JsonNode readUserTaskProps(UserTask ut) {
        ObjectNode props = mapper.createObjectNode();
        for (String ext : USER_TASK_PROP_EXTS) {
            JsonNode v = readExtJson(ut, ext);
            if (v != null) {
                props.set(ext, v);
            }
        }
        return props;
    }

    private JsonNode readCallActivity(CallActivity ca) {
        ObjectNode c = mapper.createObjectNode();
        if (StringUtils.hasText(ca.getCalledElement())) {
            c.put("calledElement", ca.getCalledElement());
        }
        c.put("inheritVariables", ca.isInheritVariables());
        if (ca.getInParameters() != null && !ca.getInParameters().isEmpty()) {
            var arr = mapper.createArrayNode();
            for (IOParameter p : ca.getInParameters()) {
                ObjectNode e = mapper.createObjectNode();
                if (StringUtils.hasText(p.getTarget())) {
                    e.put("child", p.getTarget());
                }
                if (StringUtils.hasText(p.getSource())) {
                    e.put("parent", p.getSource());
                }
                arr.add(e);
            }
            c.set("paramMap", arr);
        }
        return c;
    }

    private JsonNode readTimer(org.flowable.bpmn.model.Event event) {
        TimerEventDefinition ted = timerOf(event);
        ObjectNode t = mapper.createObjectNode();
        if (ted == null) {
            return t;
        }
        if (StringUtils.hasText(ted.getTimeDate())) {
            t.put("mode", "date");
            t.put("value", ted.getTimeDate());
        } else if (StringUtils.hasText(ted.getTimeCycle())) {
            t.put("mode", "cycle");
            t.put("value", ted.getTimeCycle());
        } else {
            t.put("mode", "duration");
            if (StringUtils.hasText(ted.getTimeDuration())) {
                t.put("value", ted.getTimeDuration());
            }
        }
        return t;
    }

    private SequenceFlowDto readEdge(SequenceFlow sf, FlowElementsContainer container, Ctx ctx) {
        SequenceFlowDto e = new SequenceFlowDto();
        e.id = sf.getId();
        e.source = sf.getSourceRef();
        e.target = sf.getTargetRef();
        if (StringUtils.hasText(sf.getName())) {
            e.name = sf.getName();
        }
        List<GraphicInfo> way = ctx.model().getFlowLocationMap().get(sf.getId());
        if (way != null && !way.isEmpty()) {
            List<Point> pts = new ArrayList<>();
            for (GraphicInfo g : way) {
                pts.add(new Point(g.getX(), g.getY()));
            }
            e.waypoints = pts;
        }

        FlowElement src = container.getFlowElement(sf.getSourceRef());
        boolean isDefault = src instanceof Gateway g && sf.getId().equals(g.getDefaultFlow());
        if (isDefault) {
            e.isDefault = Boolean.TRUE;
            return e;
        }
        // 结构化条件优先从 oa:condition 扩展无损回读（正向「供回编辑」存的原始 BranchCondition，operator 名形保留）
        JsonNode condExt = readExtJson(sf, "condition");
        if (condExt != null) {
            e.condition = condExt;
            return e;
        }
        String ce = sf.getConditionExpression();
        if (StringUtils.hasText(ce)) {
            e.expression = unwrapExprEval(ce);
        }
        return e;
    }

    /** {@code ${exprEval.evalBoolean(execution,'<escaped>')}} → 原始公式串（反转义），非该形则原样返回。 */
    private String unwrapExprEval(String conditionExpression) {
        Matcher m = EXPR_EVAL.matcher(conditionExpression);
        if (m.matches()) {
            return m.group(1).replace("\\'", "'").replace("\\\\", "\\");
        }
        return conditionExpression;
    }

    /* ---------------- DI / 扩展元素读取助手 ---------------- */

    private void setDi(FlowNodeDto n, String id, Ctx ctx, int idx) {
        GraphicInfo gi = ctx.model().getGraphicInfo(id);
        if (gi != null) {
            n.position = new Point(gi.getX(), gi.getY());
            if (gi.getWidth() > 0 && gi.getHeight() > 0) {
                Size s = new Size();
                s.w = gi.getWidth();
                s.h = gi.getHeight();
                n.size = s;
            }
        } else {
            n.position = new Point(idx * 160.0, 100.0);
            ctx.warnMissingDi();
        }
    }

    private boolean hasTerminate(EndEvent end) {
        for (EventDefinition ed : end.getEventDefinitions()) {
            if (ed instanceof TerminateEventDefinition) {
                return true;
            }
        }
        return false;
    }

    private TimerEventDefinition timerOf(org.flowable.bpmn.model.Event event) {
        for (EventDefinition ed : event.getEventDefinitions()) {
            if (ed instanceof TimerEventDefinition ted) {
                return ted;
            }
        }
        return null;
    }

    /** 读第一个同名 {@code oa:} 扩展元素文本；无则 null。 */
    private String readExtText(BaseElement el, String name) {
        List<ExtensionElement> list = el.getExtensionElements().get(name);
        if (list == null || list.isEmpty()) {
            return null;
        }
        return list.get(0).getElementText();
    }

    /**
     * 读 {@code oa:} 扩展元素并解析为 {@link JsonNode}：正向对 object/array 存 JSON、对标量存原始文本
     * （如 emptyStrategy=AUTO_PASS / commentRequired=true）。故先尝试 readTree（合法 JSON→对应节点），
     * 失败则当作字符串字面量（StringNode），保证 AUTO_PASS 等裸词不丢。无该扩展返回 null。
     */
    private JsonNode readExtJson(BaseElement el, String name) {
        String text = readExtText(el, name);
        if (text == null) {
            return null;
        }
        if (!StringUtils.hasText(text)) {
            return StringNode.valueOf(text);
        }
        try {
            return mapper.readTree(text);
        } catch (Exception ignore) {
            return StringNode.valueOf(text);
        }
    }

    private void putIfText(ObjectNode node, String field, String value) {
        if (StringUtils.hasText(value)) {
            node.put(field, value);
        }
    }

    private void setIfJson(ObjectNode node, String field, JsonNode value) {
        if (value != null && !value.isNull() && !value.isMissingNode()) {
            node.set(field, value);
        }
    }
}
