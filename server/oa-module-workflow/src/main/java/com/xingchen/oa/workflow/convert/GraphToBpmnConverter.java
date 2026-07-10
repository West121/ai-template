package com.xingchen.oa.workflow.convert;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.convert.graph.FlowNodeDto;
import com.xingchen.oa.workflow.convert.graph.Point;
import com.xingchen.oa.workflow.convert.graph.ProcessModel;
import com.xingchen.oa.workflow.convert.graph.SequenceFlowDto;
import org.flowable.bpmn.model.Activity;
import org.flowable.bpmn.model.BaseElement;
import org.flowable.bpmn.model.BoundaryEvent;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.CallActivity;
import org.flowable.bpmn.model.EndEvent;
import org.flowable.bpmn.model.Event;
import org.flowable.bpmn.model.ExclusiveGateway;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.FlowElementsContainer;
import org.flowable.bpmn.model.FlowNode;
import org.flowable.bpmn.model.FlowableListener;
import org.flowable.bpmn.model.Gateway;
import org.flowable.bpmn.model.GraphicInfo;
import org.flowable.bpmn.model.IOParameter;
import org.flowable.bpmn.model.ImplementationType;
import org.flowable.bpmn.model.InclusiveGateway;
import org.flowable.bpmn.model.IntermediateCatchEvent;
import org.flowable.bpmn.model.MultiInstanceLoopCharacteristics;
import org.flowable.bpmn.model.ParallelGateway;
import org.flowable.bpmn.model.Process;
import org.flowable.bpmn.model.SequenceFlow;
import org.flowable.bpmn.model.ServiceTask;
import org.flowable.bpmn.model.StartEvent;
import org.flowable.bpmn.model.SubProcess;
import org.flowable.bpmn.model.TerminateEventDefinition;
import org.flowable.bpmn.model.TimerEventDefinition;
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
 * <p>切片 3（N-B-01）已补全全部节点类型（按附录 B 映射表 + 附录 C.1 裁定）：
 * <ul>
 *   <li>{@code startEvent} / {@code endEvent}（含 {@code terminate:true} 终止型，加 TerminateEventDefinition）</li>
 *   <li>{@code userTask}（审批，消费 {@code props: WfNodeProps} → oa: 扩展元素 + {@code ${assignee}} 多实例）</li>
 *   <li>{@code serviceTask}（按 {@code service.impl} 判别：autoApprove / autoReject → {@code ${wfAutoDecide}}；
 *       trigger → {@code ${wfTriggerDelegate}}；delegate → 任意 delegateExpression 直配）</li>
 *   <li>OA 行为一等节点：{@code cc}→{@code ${wfCcDelegate}} / {@code ai}→{@code ${wfAiApprovalDelegate}} /
 *       {@code webhook}→{@code ${wfWebhookDelegate}}（delegate bean 名与旧路径一致，红线）</li>
 *   <li>{@code exclusiveGateway} / {@code parallelGateway} / {@code inclusiveGateway}（单网关直译）</li>
 *   <li>{@code callActivity}（调用已部署子流程）/ 嵌入式 {@code subProcess}（递归转换 children 子图）</li>
 *   <li>{@code timerCatch}（intermediateCatchEvent）/ {@code timerBoundary}（boundaryEvent + attachedToRef +
 *       cancelActivity 中断/非中断）；定时支持 duration / date / cycle（周期 timeCycle）</li>
 *   <li>{@code sequenceFlow}：{@code condition} 结构化走 {@link ConditionCompiler}→UEL（红线不变）；
 *       {@code isDefault} 默认分支；{@code expression} 高级公式包成 {@code ${exprEval.evalBoolean(execution,'…')}}
 *       交 Tier 1 引擎运行时求值（与 condition 互斥，附录 C.4）</li>
 * </ul>
 * 并<b>消费前端坐标</b>（position/size/waypoints）生成 BPMN DI，替代旧 {@code autoLayout()}。
 *
 * <p>附录 C.3：{@code autoReject} 不再隐式补 terminate——终止由前端显式 {@code endEvent{terminate:true}} 承接，
 * 转换器遇到「拒绝路径」不自动改拓扑。未知 type 字符串抛清晰异常。
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
            addProcessEvents(pm.flowConfig);
            model.addProcess(process);
            // 顶层图 + 递归子图统一走 buildGraph（container 抽象，直译不合成拓扑）
            buildGraph(process, pm.nodes, pm.edges);
            return model;
        }

        /**
         * 直译一段图（节点 + 连线 + DI）到给定 {@link FlowElementsContainer}。顶层 container=process，
         * 嵌入式 subProcess 递归时 container=SubProcess。三步：建节点 → 解析边界事件宿主 → 建连线 → 补 DI。
         */
        private void buildGraph(FlowElementsContainer container, List<FlowNodeDto> nodes, List<SequenceFlowDto> edges) {
            List<SequenceFlowDto> es = edges == null ? List.of() : edges;
            for (FlowNodeDto node : nodes) {
                buildNode(container, node);
            }
            resolveBoundaries(container);
            for (SequenceFlowDto edge : es) {
                buildEdge(container, edge);
            }
            buildDi(container, nodes, es);
        }

        private void buildNode(FlowElementsContainer c, FlowNodeDto node) {
            String type = node.type == null ? "" : node.type;
            switch (type) {
                case "startEvent" -> startEvent(c, node);
                case "endEvent" -> endEvent(c, node);
                case "userTask" -> userTask(c, node);
                case "serviceTask" -> serviceTask(c, node);
                case "exclusiveGateway" -> exclusiveGateway(c, node);
                case "parallelGateway" -> parallelGateway(c, node);
                case "inclusiveGateway" -> inclusiveGateway(c, node);
                case "callActivity" -> callActivity(c, node);
                case "subProcess" -> subProcess(c, node);
                case "timerCatch" -> timerCatch(c, node);
                case "timerBoundary" -> timerBoundary(c, node);
                case "cc" -> cc(c, node);
                case "ai" -> ai(c, node);
                case "webhook" -> webhook(c, node);
                default -> throw new BusinessException(400, "未知流程节点类型: " + type);
            }
        }

        private void startEvent(FlowElementsContainer c, FlowNodeDto node) {
            StartEvent start = new StartEvent();
            start.setId(nid(node));
            start.setName(name(node, "开始"));
            c.addFlowElement(start);
        }

        private void endEvent(FlowElementsContainer c, FlowNodeDto node) {
            EndEvent end = new EndEvent();
            end.setId(nid(node));
            end.setName(name(node, "结束"));
            if (Boolean.TRUE.equals(node.terminate)) {
                end.addEventDefinition(new TerminateEventDefinition());
            }
            c.addFlowElement(end);
        }

        private void exclusiveGateway(FlowElementsContainer c, FlowNodeDto node) {
            ExclusiveGateway gw = new ExclusiveGateway();
            gw.setId(nid(node));
            gw.setName(name(node, "网关"));
            c.addFlowElement(gw);
        }

        /**
         * 并行网关：单网关直译（fork/join 由前端显式建两个节点，各自成对）。无条件出边——
         * fork 全激活各分支、join 全部到达才继续；default/condition 对并行无意义，转换器不为其出边设条件。
         */
        private void parallelGateway(FlowElementsContainer c, FlowNodeDto node) {
            ParallelGateway gw = new ParallelGateway();
            gw.setId(nid(node));
            gw.setName(name(node, "并行网关"));
            c.addFlowElement(gw);
        }

        /**
         * 包容网关：单网关直译。满足条件的多分支都走并汇聚，全不满足走默认分支——
         * 默认分支同 exclusive 处理（{@code edge.isDefault} 设 gateway.default），出边条件走结构化/公式二源。
         */
        private void inclusiveGateway(FlowElementsContainer c, FlowNodeDto node) {
            InclusiveGateway gw = new InclusiveGateway();
            gw.setId(nid(node));
            gw.setName(name(node, "包容网关"));
            c.addFlowElement(gw);
        }

        /**
         * 审批用户任务：逻辑照搬旧 {@code JsonToBpmnConverter#approval}，仅把取值来源从节点顶层字段
         * 改为 {@code node.props}（WfNodeProps）。扩展元素名保持一致（assigneeRules/emptyStrategy/…），
         * 运行时由 {@code wfAssigneeResolver}/{@code wfVote}/{@code wfEventDelegate} 等 bean 读取。
         */
        private void userTask(FlowElementsContainer c, FlowNodeDto node) {
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

            // 办理选项 candidate=true 等价分组认领（附录 C.8：只认 props.handleOptions.candidate）
            boolean candidate = props.path("handleOptions").path("candidate").asBoolean(false);
            if (candidate) {
                task.setCandidateUsers(List.of(
                        "${wfAssigneeResolver.resolveCsv(execution,'" + nid + "')}"));
                addExtText(task, "groupMode", "CLAIM");
                c.addFlowElement(task);
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
            c.addFlowElement(task);
        }

        /**
         * 服务任务：按 {@code service.impl} 判别（附录 B / 附录 C.1）。
         * autoApprove / autoReject → {@code ${wfAutoDecide}}（autoDecision）；trigger → {@code ${wfTriggerDelegate}}；
         * delegate → 任意 delegateExpression 直配（为将来 scriptTask 过渡）。delegate bean 名与旧路径一致（红线）。
         */
        private void serviceTask(FlowElementsContainer c, FlowNodeDto node) {
            JsonNode svc = node.service == null ? NullNode.getInstance() : node.service;
            String impl = svc.path("impl").asString("");
            switch (impl) {
                case "autoApprove" -> autoDecide(c, node, "APPROVE", "自动通过");
                // 附录 C.3：autoReject 只写 serviceTask，不再隐式补 terminate（终止由显式 endEvent{terminate} 承接）
                case "autoReject" -> autoDecide(c, node, "REJECT", "自动拒绝");
                case "trigger" -> trigger(c, node, svc);
                case "delegate" -> genericDelegate(c, node, svc);
                case "script" -> scriptTask(c, node);
                default -> throw new BusinessException(400, "未知 serviceTask.impl(需 autoApprove/autoReject/trigger/delegate/script): " + impl);
            }
        }

        /**
         * 脚本节点（Tier 2）：serviceTask delegateExpression {@code ${wfScriptDelegate}}，
         * 语言/脚本体取自 {@code node.script}（{@code {lang, code}}）→ 存 oa: 扩展元素 scriptLang/scriptCode，
         * 运行时由 {@code wfScriptDelegate} 读出交 {@code ScriptService} 执行。
         * <b>脚本是部署态工件</b>：随流程定义版本化落 BPMN，运行时不接受用户注入（治理见 §3.3）。
         */
        private void scriptTask(FlowElementsContainer c, FlowNodeDto node) {
            JsonNode s = node.script == null ? NullNode.getInstance() : node.script;
            String lang = s.path("lang").asString("");
            String code = s.path("code").asString("");
            if (!StringUtils.hasText(lang) || !StringUtils.hasText(code)) {
                throw new BusinessException(400, "serviceTask{script} 缺少 script.lang/script.code: " + node.id);
            }
            ServiceTask st = newDelegateTask(node, "脚本", "${wfScriptDelegate}");
            addExtText(st, "scriptLang", lang);
            addExtText(st, "scriptCode", code);
            c.addFlowElement(st);
        }

        /** 自动决策：serviceTask delegateExpression {@code ${wfAutoDecide}}，autoDecision=APPROVE|REJECT。 */
        private void autoDecide(FlowElementsContainer c, FlowNodeDto node, String decision, String fallbackName) {
            ServiceTask st = newDelegateTask(node, fallbackName, "${wfAutoDecide}");
            addExtText(st, "autoDecision", decision);
            c.addFlowElement(st);
        }

        /**
         * 触发节点：serviceTask delegateExpression {@code ${wfTriggerDelegate}}。triggerType/handler/webhookUrl/config
         * 存 oa: 扩展元素（取值照搬旧 {@code trigger()}）。TIMER 型的定时值另存 oa:triggerTimer——
         * 图直译不合成前置 timer 节点（旧树路径的 TIMER 前置 timer 是拓扑合成，本路径由前端显式 timerCatch 表达）。
         */
        private void trigger(FlowElementsContainer c, FlowNodeDto node, JsonNode svc) {
            ServiceTask st = newDelegateTask(node, "触发", "${wfTriggerDelegate}");
            addExtText(st, "triggerType", svc.path("triggerType").asString("IMMEDIATE"));
            addExtText(st, "triggerHandler", svc.path("handler").asString(null));
            addExtText(st, "webhookUrl", svc.path("webhookUrl").asString(null));
            addExt(st, "triggerConfig", svc.path("config"));
            addExtText(st, "triggerTimer", svc.path("timer").asString(null));
            c.addFlowElement(st);
        }

        /** 通用 serviceTask{delegate}：直配任意 delegateExpression。 */
        private void genericDelegate(FlowElementsContainer c, FlowNodeDto node, JsonNode svc) {
            String expr = svc.path("delegateExpression").asString("");
            if (!StringUtils.hasText(expr)) {
                throw new BusinessException(400, "serviceTask{delegate} 缺少 delegateExpression: " + node.id);
            }
            ServiceTask st = newDelegateTask(node, "服务任务", expr);
            c.addFlowElement(st);
        }

        /** 抄送：serviceTask delegateExpression {@code ${wfCcDelegate}}，抄送人取 props.ccUsers（附录 A.3 迁移）。 */
        private void cc(FlowElementsContainer c, FlowNodeDto node) {
            JsonNode props = node.props == null ? NullNode.getInstance() : node.props;
            ServiceTask st = newDelegateTask(node, "抄送", "${wfCcDelegate}");
            addExt(st, "ccUsers", props.path("ccUsers"));
            c.addFlowElement(st);
        }

        /** AI 审批：serviceTask delegateExpression {@code ${wfAiApprovalDelegate}}，配置取自 node.ai。 */
        private void ai(FlowElementsContainer c, FlowNodeDto node) {
            JsonNode a = node.ai == null ? NullNode.getInstance() : node.ai;
            ServiceTask st = newDelegateTask(node, "AI审批", "${wfAiApprovalDelegate}");
            addExtText(st, "aiModel", a.path("model").asString(null));
            addExtText(st, "aiSystemPrompt", a.path("systemPrompt").asString(null));
            addExt(st, "aiFormContext", a.path("formContext"));
            addExt(st, "aiOutputMap", a.path("outputMap"));
            c.addFlowElement(st);
        }

        /** Webhook：serviceTask delegateExpression {@code ${wfWebhookDelegate}}，url 取自 node.webhook.url。 */
        private void webhook(FlowElementsContainer c, FlowNodeDto node) {
            JsonNode w = node.webhook == null ? NullNode.getInstance() : node.webhook;
            ServiceTask st = newDelegateTask(node, "Webhook", "${wfWebhookDelegate}");
            addExtText(st, "webhookUrl", w.path("url").asString(null));
            c.addFlowElement(st);
        }

        /**
         * 调用活动（callActivity）：调用已部署子流程 calledElement，继承父变量 + 参数映射。
         * 附录 B：异步旁路拓扑改由前端显式画（fork+subEnd），转换器不再合成——本方法只建 CallActivity 本体。
         */
        private void callActivity(FlowElementsContainer c, FlowNodeDto node) {
            JsonNode ca = node.callActivity == null ? NullNode.getInstance() : node.callActivity;
            String called = JsonToBpmnConverter.sanitizeId(ca.path("calledElement").asString(""));
            if (!StringUtils.hasText(called) || "n".equals(called)) {
                throw new BusinessException(400, "callActivity 缺少 calledElement: " + node.id);
            }
            CallActivity call = new CallActivity();
            call.setId(nid(node));
            call.setName(name(node, "子流程"));
            call.setCalledElement(called);
            call.setInheritVariables(ca.path("inheritVariables").asBoolean(true));
            JsonNode paramMap = ca.path("paramMap"); // [{child, parent}]
            if (paramMap.isArray() && !paramMap.isEmpty()) {
                List<IOParameter> ins = new ArrayList<>();
                for (JsonNode pmEntry : paramMap) {
                    String child = pmEntry.path("child").asString("");
                    String parent = pmEntry.path("parent").asString("");
                    if (!StringUtils.hasText(child)) {
                        continue;
                    }
                    IOParameter p = new IOParameter();
                    p.setTarget(child);   // 子流程变量
                    p.setSource(parent);  // 父流程字段/变量
                    ins.add(p);
                }
                if (!ins.isEmpty()) {
                    call.setInParameters(ins);
                }
            }
            addExtText(call, "subDefCode", called);
            c.addFlowElement(call);
        }

        /**
         * 嵌入式子流程（BPMN SubProcess）：递归转换 children 子图（其内含独立 start/end 的 nodes/edges）
         * 到 SubProcess 内联元素，复用主 {@link #buildGraph} 逻辑（container=SubProcess）。旧路径完全不支持。
         */
        private void subProcess(FlowElementsContainer c, FlowNodeDto node) {
            SubProcess sp = new SubProcess();
            sp.setId(nid(node));
            sp.setName(name(node, "子流程"));
            c.addFlowElement(sp);
            if (node.children == null || node.children.nodes == null || node.children.nodes.isEmpty()) {
                throw new BusinessException(400, "嵌入式 subProcess 缺少 children.nodes: " + node.id);
            }
            buildGraph(sp, node.children.nodes, node.children.edges);
        }

        /** 中间捕获定时（intermediateCatchEvent + timerEventDefinition）：到点进入下一步。等价旧钉钉 timer。 */
        private void timerCatch(FlowElementsContainer c, FlowNodeDto node) {
            IntermediateCatchEvent ice = new IntermediateCatchEvent();
            ice.setId(nid(node));
            ice.setName(name(node, "定时"));
            ice.addEventDefinition(timerDef(node.timer));
            c.addFlowElement(ice);
        }

        /**
         * 边界定时（boundaryEvent + timerEventDefinition），附着在宿主活动上（本模型新增，旧完全不支持）。
         * attachedTo 指向同层宿主节点 id（不走 edge）；cancelActivity 缺省 true 为中断型（到点取消宿主走出边），
         * false 为非中断型（宿主继续、并行走出边，如超时提醒不打断）。宿主对象在 {@link #resolveBoundaries} 统一回填。
         */
        private void timerBoundary(FlowElementsContainer c, FlowNodeDto node) {
            if (!StringUtils.hasText(node.attachedTo)) {
                throw new BusinessException(400, "timerBoundary 缺少 attachedTo: " + node.id);
            }
            BoundaryEvent be = new BoundaryEvent();
            be.setId(nid(node));
            be.setName(name(node, "边界定时"));
            be.setAttachedToRefId(JsonToBpmnConverter.sanitizeId(node.attachedTo));
            be.setCancelActivity(node.cancelActivity == null || Boolean.TRUE.equals(node.cancelActivity));
            be.addEventDefinition(timerDef(node.timer));
            c.addFlowElement(be);
        }

        /** 定时定义：mode=duration→timeDuration / date→timeDate / cycle→timeCycle（周期）。 */
        private TimerEventDefinition timerDef(JsonNode timer) {
            JsonNode t = timer == null ? NullNode.getInstance() : timer;
            TimerEventDefinition ted = new TimerEventDefinition();
            String mode = t.path("mode").asString("duration");
            String value = t.path("value").asString(null);
            switch (mode.toLowerCase()) {
                case "date" -> ted.setTimeDate(value);
                case "cycle" -> ted.setTimeCycle(value); // ISO-8601 循环，如 R3/PT10M
                default -> ted.setTimeDuration(value);   // ISO-8601 时长，如 PT5S / P1D
            }
            return ted;
        }

        /** 边界事件宿主回填：节点全建完后，把同层 BoundaryEvent 的 attachedToRefId 解析为宿主 Activity 对象。 */
        private void resolveBoundaries(FlowElementsContainer container) {
            for (FlowElement el : container.getFlowElements()) {
                if (el instanceof BoundaryEvent be
                        && be.getAttachedToRef() == null
                        && StringUtils.hasText(be.getAttachedToRefId())) {
                    FlowElement host = container.getFlowElement(be.getAttachedToRefId());
                    if (host instanceof Activity act) {
                        be.setAttachedToRef(act);
                    } else {
                        throw new BusinessException(400,
                                "timerBoundary 的 attachedTo 必须指向同层活动节点(userTask/serviceTask/callActivity/subProcess/cc/ai/webhook): "
                                        + be.getAttachedToRefId());
                    }
                }
            }
        }

        /** delegateExpression 服务任务样板（统一 id/name/impl 装配）。 */
        private ServiceTask newDelegateTask(FlowNodeDto node, String fallbackName, String delegateExpression) {
            ServiceTask st = new ServiceTask();
            st.setId(nid(node));
            st.setName(name(node, fallbackName));
            st.setImplementationType(ImplementationType.IMPLEMENTATION_TYPE_DELEGATEEXPRESSION);
            st.setImplementation(delegateExpression);
            return st;
        }

        private void buildEdge(FlowElementsContainer c, SequenceFlowDto edge) {
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
                FlowElement s = c.getFlowElement(src);
                if (s instanceof Gateway g) {
                    g.setDefaultFlow(eid);
                } else {
                    throw new BusinessException(400, "isDefault 默认分支的 source 必须是网关: " + edge.source);
                }
            } else if (hasExpr && hasCond) {
                throw new BusinessException(400, "同一条边 condition 与 expression 互斥(附录 C.4): " + eid);
            } else if (hasExpr) {
                // 高级公式逃生口（Tier 1 引擎路径，附录 C.4）：不原样下发，包成
                // ${exprEval.evalBoolean(execution,'<转义后expr>')}，运行时由 exprEval bean 交 Aviator 求值。
                flow.setConditionExpression(wrapExprEval(edge.expression));
            } else if (hasCond) {
                // 结构化条件：ConditionCompiler 编译 UEL（红线不变）+ 存 oa:condition 供回编辑
                String uel = compileCondition(edge.condition);
                if (StringUtils.hasText(uel)) {
                    flow.setConditionExpression(uel);
                }
                addExtText(flow, "condition", edge.condition.toString());
            }
            c.addFlowElement(flow);
        }

        /**
         * 高级公式条件 → conditionExpression：包成 {@code ${exprEval.evalBoolean(execution,'<expr>')}}。
         * Flowable 网关运行时以 UEL 求值该串 → 回调 {@code exprEval} bean（{@link com.xingchen.oa.workflow.engine.expression.ExprEval}）
         * → 取 execution 变量作上下文交 Aviator 沙箱求值，使高级公式真正参与网关路由（而非把公式串误当 UEL 直跑）。
         * 单引号/反斜杠转义镜像 {@link ConditionCompiler} 的 UEL 字符串字面量转义，避免注入/破坏 UEL 结构。
         */
        private String wrapExprEval(String expr) {
            String escaped = expr.replace("\\", "\\\\").replace("'", "\\'");
            return "${exprEval.evalBoolean(execution,'" + escaped + "')}";
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

        /**
         * 为给定图（container 内的 nodes/edges）补 BPMN DI。子图（subProcess children）递归时各自补——
         * DI 图形按元素 id 挂到全局 {@link BpmnModel}（子元素坐标为前端画布绝对坐标，原样记录）。
         */
        private void buildDi(FlowElementsContainer container, List<FlowNodeDto> nodes, List<SequenceFlowDto> edges) {
            for (FlowNodeDto dto : nodes) {
                if (!StringUtils.hasText(dto.id)) {
                    continue;
                }
                FlowElement el = container.getFlowElement(JsonToBpmnConverter.sanitizeId(dto.id));
                if (!(el instanceof FlowNode fn)) {
                    continue;
                }
                double[] wh = sizeOf(fn, dto);
                GraphicInfo gi = new GraphicInfo();
                gi.setWidth(wh[0]);
                gi.setHeight(wh[1]);
                gi.setX(dto.position != null ? dto.position.x : 0);
                gi.setY(dto.position != null ? dto.position.y : 0);
                model.addGraphicInfo(fn.getId(), gi);
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

        /** 节点尺寸：优先前端 size；否则事件 30×30 / 网关 40×40 / 任务 100×60 */
        private double[] sizeOf(FlowNode fn, FlowNodeDto dto) {
            if (dto != null && dto.size != null && dto.size.w > 0 && dto.size.h > 0) {
                return new double[]{dto.size.w, dto.size.h};
            }
            if (fn instanceof Event) { // start/end/boundary/intermediateCatch 事件统一 30×30
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

        /**
         * 流程级事件：把 {@code flowConfig.events}（ProcessEvent[]）挂成<b>流程级 executionListener</b>
         * （{@code ${wfEventDelegate}}，event=start/end）。事件配置本身随 {@code oa:flowConfig} 扩展整体落库
         * （已在 {@link #build()} 写入），运行时 {@code wfEventDelegate} 读回 {@code flowConfig.events} 分发动作
         * （NOTIFY/WEBHOOK/SCRIPT/API），与节点事件同一套动作实现。
         *
         * <p><b>落地范围</b>：PROCESS_START→start、PROCESS_END→end。
         * <b>PROCESS_CANCEL（TODO）</b>：撤销/终止不经流程正常 end——process-level "end" 监听无法区分正常结束与
         * 撤销/终止，Flowable 亦无「进程取消」的 process-level executionListener 事件；可靠落点在 {@code InstanceService}
         * 的 cancel/terminate 端点侧挂钩（另行切片），故本转换器暂不为 PROCESS_CANCEL 挂监听。
         */
        private void addProcessEvents(JsonNode flowConfig) {
            if (flowConfig == null || flowConfig.isMissingNode() || flowConfig.isNull()) {
                return;
            }
            JsonNode events = flowConfig.path("events");
            if (!events.isArray() || events.isEmpty()) {
                return;
            }
            Set<String> execEvents = new LinkedHashSet<>();
            for (JsonNode ev : events) {
                String le = executionListenerEventFor(ev.path("trigger").asString(""));
                if (le != null) {
                    execEvents.add(le);
                }
            }
            for (String le : execEvents) {
                FlowableListener l = new FlowableListener();
                l.setEvent(le);
                l.setImplementationType(ImplementationType.IMPLEMENTATION_TYPE_DELEGATEEXPRESSION);
                l.setImplementation("${wfEventDelegate}");
                process.getExecutionListeners().add(l);
            }
        }

        private String executionListenerEventFor(String trigger) {
            return switch (trigger) {
                case "PROCESS_START" -> "start";
                case "PROCESS_END" -> "end";
                // PROCESS_CANCEL：见 addProcessEvents 文档，暂不落地（TODO）
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
