package com.hentor.oa.workflow.convert;

import com.hentor.oa.common.exception.BusinessException;
import org.flowable.bpmn.model.BaseElement;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.CallActivity;
import org.flowable.bpmn.model.EndEvent;
import org.flowable.bpmn.model.ExclusiveGateway;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
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
import org.flowable.bpmn.model.TerminateEventDefinition;
import org.flowable.bpmn.model.TimerEventDefinition;
import org.flowable.bpmn.model.UserTask;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 仿钉钉设计器 JSON → 可部署 BPMN {@link BpmnModel}。
 * 支持节点：approval（审批，多实例 ANY/ALL/SEQUENCE）/ condition（排它网关 + 结构化条件编译）/ cc（抄送 serviceTask）。
 * 审批人求值在运行时由 {@code wfAssigneeResolver} bean 通过多实例 collection 表达式注入，
 * 抄送处理由 {@code wfCcDelegate} 通过 serviceTask delegateExpression 承接。
 */
@Component
public class JsonToBpmnConverter {

    public static final String OA_NS = "http://oa/bpmn";
    public static final String OA_PREFIX = "oa";

    /**
     * @param defCode     流程定义编码（作为 process id）
     * @param name        流程名
     * @param formKey     绑定表单 key（formCode:version），可空
     * @param designerRoot 设计器 JSON 根：{ "nodes": [ ... ] }
     */
    public BpmnModel convert(String defCode, String name, String formKey, JsonNode designerRoot) {
        return new Builder(defCode, name, formKey, designerRoot).build();
    }

    private static final class Builder {
        private final String defCode;
        private final String name;
        private final String formKey;
        private final JsonNode root;
        private final Process process = new Process();
        private int seq = 0;

        Builder(String defCode, String name, String formKey, JsonNode root) {
            this.defCode = sanitizeId(defCode);
            this.name = name;
            this.formKey = formKey;
            this.root = root;
        }

        BpmnModel build() {
            BpmnModel model = new BpmnModel();
            model.getNamespaces().put(OA_PREFIX, OA_NS);
            process.setId(defCode);
            process.setName(name);
            // P1：流程级配置（流程操作开关/启动权限/时限/安全）写入 process 扩展元素 oa:flowConfig
            addExt(process, "flowConfig", root.path("flowConfig"));
            model.addProcess(process);

            StartEvent start = new StartEvent();
            start.setId("start");
            start.setName("发起");
            process.addFlowElement(start);

            JsonNode nodes = root.path("nodes");
            if (nodes == null || !nodes.isArray()) {
                throw new BusinessException(400, "流程设计 JSON 缺少 nodes 数组");
            }
            Seg body = convertSequence(nodes);

            EndEvent end = new EndEvent();
            end.setId("end");
            end.setName("结束");
            process.addFlowElement(end);

            if (body.isEmpty()) {
                addFlow("start", "end", null);
            } else {
                addFlow("start", body.first, null);
                if (!body.terminal) {
                    addFlow(body.last, "end", null);
                }
            }
            // 生成 BPMNDI 图形坐标（BPMNShape/BPMNEdge），供前端 bpmn-js 渲染与高亮附着
            autoLayout(model);
            return model;
        }

        /** 转换一段线性节点序列，返回首尾元素 id；遇到终止节点（自动拒绝）后其余节点不可达，停止串联 */
        private Seg convertSequence(JsonNode nodes) {
            String first = null;
            String prev = null;
            boolean prevTerminal = false;
            for (JsonNode node : nodes) {
                Seg s = convertNode(node);
                if (s.isEmpty()) {
                    continue;
                }
                if (first == null) {
                    first = s.first;
                }
                if (prev != null) {
                    addFlow(prev, s.first, null);
                }
                prev = s.last;
                prevTerminal = s.terminal;
                if (prevTerminal) {
                    break;
                }
            }
            return new Seg(first, prev, prevTerminal);
        }

        private Seg convertNode(JsonNode node) {
            String type = node.path("type").asString("");
            return switch (type) {
                case "approval" -> approval(node);
                case "cc" -> cc(node);
                case "condition" -> condition(node);
                case "inclusive" -> condition(node);      // 包容分支：等价 condition + gatewayType=INCLUSIVE
                case "parallel" -> parallel(node);        // 并行分支：fork 全激活 → join 汇聚
                case "autoApprove" -> autoApprove(node);  // 自动通过：serviceTask 自动记 AUTO_APPROVE 后继续
                case "autoReject" -> autoReject(node);    // 自动拒绝：serviceTask 记 AUTO_REJECT 并终止实例为 REJECTED
                case "webhook" -> webhook(node);
                case "subprocess" -> subprocess(node);   // P3：子流程 CallActivity（同步/异步旁路）
                case "timer" -> timer(node);              // P3：定时 intermediateCatchEvent
                case "trigger" -> trigger(node);          // P3：触发 serviceTask→TriggerDelegate
                case "ai" -> ai(node);                    // P3：AI 审批 serviceTask→AiApprovalDelegate
                case "start" -> Seg.EMPTY; // 起始节点已由引擎 startEvent 承接
                default -> throw new BusinessException(400, "未知流程节点类型: " + type);
            };
        }

        private Seg approval(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("approval_" + (++seq)));
            UserTask task = new UserTask();
            task.setId(nid);
            task.setName(node.path("name").asString("审批"));
            if (StringUtils.hasText(formKey)) {
                task.setFormKey(formKey);
            }
            addExt(task, "assigneeRules", node.path("assigneeRules"));
            addExtText(task, "emptyStrategy", node.path("emptyStrategy").asString("AUTO_PASS"));
            addExt(task, "allowedOps", node.path("allowedOps"));   // P1：按钮操作白名单（运行时覆盖默认 allowedOps）
            addExt(task, "handleOptions", node.path("handleOptions"));           // P1/P2：办理选项（候选/历史优先/自动跳过）
            addExt(task, "timeout", node.path("timeout"));
            addExt(task, "formPerms", node.path("formPerms")); // P3：节点级表单字段权限 HIDDEN/READ/EDIT
            addExt(task, "auditMenu", node.path("auditMenu"));                   // P2：审核菜单（JUMP/RETURN 声明）
            addExt(task, "commentRequired", node.path("commentRequired"));       // P2：审批意见必填
            addNodeEvents(task, node.path("events"));                            // P3：节点事件 → taskListener + ext

            // 办理选项 candidate=true 等价分组认领
            boolean candidate = node.path("handleOptions").path("candidate").asBoolean(false);
            String groupMode = node.path("groupMode").asString(null);
            if ("CLAIM".equalsIgnoreCase(groupMode) || candidate) {
                // 分组策略-认领：任务入公共池，候选人运行时求值，成员 claim 后办理
                task.setCandidateUsers(List.of(
                        "${wfAssigneeResolver.resolveCsv(execution,'" + nid + "')}"));
                addExtText(task, "groupMode", "CLAIM");
                process.addFlowElement(task);
                return new Seg(nid, nid);
            }

            // 其余走多实例（含 VOTE 票签）
            task.setAssignee("${assignee}");
            String multiMode = node.path("multiMode").asString("ANY");
            MultiInstanceLoopCharacteristics mi = new MultiInstanceLoopCharacteristics();
            mi.setInputDataItem("${wfAssigneeResolver.resolve(execution,'" + nid + "')}");
            mi.setElementVariable("assignee");
            switch (multiMode.toUpperCase()) {
                case "SEQUENCE" -> mi.setSequential(true);
                case "ALL" -> mi.setSequential(false); // 全部完成（默认完成条件）
                case "VOTE" -> { // 票签：赞成权重占比过阈值提前完成
                    mi.setSequential(false);
                    mi.setCompletionCondition("${wfVote.pass(execution)}");
                    addExt(task, "voteConfig", node.path("voteConfig"));
                }
                default -> { // ANY 或签
                    mi.setSequential(false);
                    mi.setCompletionCondition("${nrOfCompletedInstances > 0}");
                }
            }
            task.setLoopCharacteristics(mi);
            addExtText(task, "multiMode", multiMode);

            process.addFlowElement(task);
            return new Seg(nid, nid);
        }

        private Seg webhook(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("webhook_" + (++seq)));
            ServiceTask st = new ServiceTask();
            st.setId(nid);
            st.setName(node.path("name").asString("Webhook"));
            st.setImplementationType(ImplementationType.IMPLEMENTATION_TYPE_DELEGATEEXPRESSION);
            st.setImplementation("${wfWebhookDelegate}");
            addExtText(st, "webhookUrl", node.path("url").asString(null));
            process.addFlowElement(st);
            return new Seg(nid, nid);
        }

        /**
         * 子流程（P3）：CallActivity 调用已部署的子流程 defCode。
         * 同步 async=false：主流程在此等待子流程结束再继续（Seg=callActivity 本身）。
         * 异步 async=true：并行网关旁路——fork 一路进子流程(到独立 end)、一路继续主流程（Seg 首尾=fork，
         * 子流程分支为死路挂在 fork 上，主流程不阻塞）。
         */
        private Seg subprocess(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("sub_" + (++seq)));
            String subDefCode = sanitizeId(node.path("defCode").asString(""));
            if (!StringUtils.hasText(subDefCode)) {
                throw new BusinessException(400, "子流程节点缺少 defCode");
            }
            boolean async = node.path("async").asBoolean(false);

            CallActivity ca = new CallActivity();
            ca.setId(async ? nid + "_call" : nid);
            ca.setName(node.path("name").asString("子流程"));
            ca.setCalledElement(subDefCode);
            ca.setInheritVariables(true); // 父变量（initiatorId 等）传入子流程
            // 参数映射 {子变量:父字段} → inParameters（source=父字段, target=子变量）
            JsonNode paramMap = node.path("paramMap");
            if (paramMap != null && paramMap.isObject()) {
                List<IOParameter> ins = new ArrayList<>();
                for (Map.Entry<String, JsonNode> e : paramMap.properties()) {
                    IOParameter p = new IOParameter();
                    p.setTarget(e.getKey());
                    p.setSource(e.getValue().asString(""));
                    ins.add(p);
                }
                if (!ins.isEmpty()) {
                    ca.setInParameters(ins);
                }
            }
            addExtText(ca, "subDefCode", subDefCode);

            if (!async) {
                process.addFlowElement(ca);
                return new Seg(nid, nid);
            }
            // 异步旁路：fork（并行网关）→ 子流程分支 + 主流程分支
            ParallelGateway fork = new ParallelGateway();
            fork.setId(nid);
            fork.setName(node.path("name").asString("子流程") + "(异步)");
            process.addFlowElement(fork);
            process.addFlowElement(ca);
            EndEvent subEnd = new EndEvent();
            subEnd.setId(nid + "_subend");
            subEnd.setName("子流程结束");
            process.addFlowElement(subEnd);
            addFlow(fork.getId(), ca.getId(), null);
            addFlow(ca.getId(), subEnd.getId(), null);
            // 主流程继续：后续节点由 convertSequence 从 fork(last) 接出
            return new Seg(nid, nid);
        }

        /** 定时节点（P3）：intermediateCatchEvent + timerEventDefinition，由 AsyncExecutor 驱动。 */
        private Seg timer(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("timer_" + (++seq)));
            IntermediateCatchEvent ice = new IntermediateCatchEvent();
            ice.setId(nid);
            ice.setName(node.path("name").asString("定时"));
            TimerEventDefinition timer = new TimerEventDefinition();
            String mode = node.path("mode").asString("duration");
            String value = node.path("value").asString(null);
            if ("date".equalsIgnoreCase(mode)) {
                timer.setTimeDate(value);
            } else {
                timer.setTimeDuration(value); // ISO-8601，如 PT5S / PT1H
            }
            ice.addEventDefinition(timer);
            process.addFlowElement(ice);
            return new Seg(nid, nid);
        }

        /**
         * 触发节点（P3）：serviceTask → {@code ${wfTriggerDelegate}}，执行注册的触发器/WEBHOOK。
         * triggerType=IMMEDIATE 立即执行；TIMER 前置一个 timer 定时事件再执行。
         */
        private Seg trigger(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("trigger_" + (++seq)));
            ServiceTask st = new ServiceTask();
            st.setId(nid);
            st.setName(node.path("name").asString("触发"));
            st.setImplementationType(ImplementationType.IMPLEMENTATION_TYPE_DELEGATEEXPRESSION);
            st.setImplementation("${wfTriggerDelegate}");
            String triggerType = node.path("triggerType").asString("IMMEDIATE");
            addExtText(st, "triggerType", triggerType);
            addExtText(st, "triggerHandler", node.path("handler").asString(null));
            addExtText(st, "webhookUrl", node.path("webhookUrl").asString(null));
            addExt(st, "triggerConfig", node.path("config"));
            process.addFlowElement(st);

            if ("TIMER".equalsIgnoreCase(triggerType)) {
                IntermediateCatchEvent ice = new IntermediateCatchEvent();
                ice.setId(nid + "_timer");
                ice.setName("触发定时");
                TimerEventDefinition timer = new TimerEventDefinition();
                timer.setTimeDuration(node.path("timer").asString("PT1S"));
                ice.addEventDefinition(timer);
                process.addFlowElement(ice);
                addFlow(ice.getId(), st.getId(), null);
                return new Seg(ice.getId(), st.getId());
            }
            return new Seg(nid, nid);
        }

        /**
         * AI 审批节点（P3）：serviceTask → {@code ${wfAiApprovalDelegate}}。
         * 配置 model/systemPrompt/formContext/outputMap 存扩展元素，运行时由 delegate 求值。
         */
        private Seg ai(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("ai_" + (++seq)));
            ServiceTask st = new ServiceTask();
            st.setId(nid);
            st.setName(node.path("name").asString("AI审批"));
            st.setImplementationType(ImplementationType.IMPLEMENTATION_TYPE_DELEGATEEXPRESSION);
            st.setImplementation("${wfAiApprovalDelegate}");
            addExtText(st, "aiModel", node.path("model").asString(null));
            addExtText(st, "aiSystemPrompt", node.path("systemPrompt").asString(null));
            addExt(st, "aiFormContext", node.path("formContext"));
            addExt(st, "aiOutputMap", node.path("outputMap"));
            process.addFlowElement(st);
            return new Seg(nid, nid);
        }

        private Seg cc(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("cc_" + (++seq)));
            ServiceTask st = new ServiceTask();
            st.setId(nid);
            st.setName(node.path("name").asString("抄送"));
            st.setImplementationType(ImplementationType.IMPLEMENTATION_TYPE_DELEGATEEXPRESSION);
            st.setImplementation("${wfCcDelegate}");
            addExt(st, "ccUsers", node.path("users"));
            process.addFlowElement(st);
            return new Seg(nid, nid);
        }

        private Seg condition(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("cond_" + (++seq)));
            boolean inclusive = "INCLUSIVE".equalsIgnoreCase(node.path("gatewayType").asString("EXCLUSIVE"))
                    || "inclusive".equalsIgnoreCase(node.path("type").asString(""));
            Gateway split = inclusive ? new InclusiveGateway() : new ExclusiveGateway();
            split.setId(nid + "_split");
            split.setName(node.path("name").asString("条件"));
            process.addFlowElement(split);
            Gateway join = inclusive ? new InclusiveGateway() : new ExclusiveGateway();
            join.setId(nid + "_join");
            join.setName("汇聚");
            process.addFlowElement(join);

            JsonNode branches = node.path("branches");
            if (branches == null || !branches.isArray() || branches.isEmpty()) {
                throw new BusinessException(400, "条件节点缺少 branches");
            }
            boolean hasDefault = false;
            for (JsonNode branch : branches) {
                boolean isDefault = branch.path("default").asBoolean(false);
                String cond = isDefault ? null
                        : ConditionCompiler.compile(branch.path("conditions"), branch.path("logic").asString("AND"));
                Seg bs = convertSequence(branch.path("steps"));
                String flowId;
                if (bs.isEmpty()) {
                    flowId = addFlow(split.getId(), join.getId(), cond);
                } else {
                    flowId = addFlow(split.getId(), bs.first, cond);
                    if (!bs.terminal) { // 终止分支（自动拒绝）不回汇聚
                        addFlow(bs.last, join.getId(), null);
                    }
                }
                if (isDefault) {
                    split.setDefaultFlow(flowId);
                    hasDefault = true;
                }
            }
            if (!hasDefault) {
                throw new BusinessException(400, "条件节点必须包含一个默认分支(default:true)");
            }
            return new Seg(split.getId(), join.getId());
        }

        /**
         * 并行分支（parallel）：parallelGateway fork 无条件全激活各分支 → parallelGateway join 汇聚。
         * 各分支为线性子序列（branches[].steps），全部到达 join 后继续。
         */
        private Seg parallel(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("parallel_" + (++seq)));
            ParallelGateway fork = new ParallelGateway();
            fork.setId(nid + "_fork");
            fork.setName(node.path("name").asString("并行"));
            process.addFlowElement(fork);
            ParallelGateway join = new ParallelGateway();
            join.setId(nid + "_join");
            join.setName("并行汇聚");
            process.addFlowElement(join);

            JsonNode branches = node.path("branches");
            if (branches == null || !branches.isArray() || branches.isEmpty()) {
                throw new BusinessException(400, "并行分支节点缺少 branches");
            }
            for (JsonNode branch : branches) {
                Seg bs = convertSequence(branch.path("steps"));
                if (bs.isEmpty()) {
                    addFlow(fork.getId(), join.getId(), null);
                } else {
                    addFlow(fork.getId(), bs.first, null);
                    if (!bs.terminal) {
                        addFlow(bs.last, join.getId(), null);
                    }
                }
            }
            return new Seg(fork.getId(), join.getId());
        }

        /**
         * 自动通过（autoApprove）：serviceTask delegateExpression {@code ${wfAutoDecide}}（autoDecision=APPROVE）。
         * 到达即自动记录 action=AUTO_APPROVE 并放行到后续节点（非终止）。
         */
        private Seg autoApprove(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("autoapprove_" + (++seq)));
            ServiceTask st = new ServiceTask();
            st.setId(nid);
            st.setName(node.path("name").asString("自动通过"));
            st.setImplementationType(ImplementationType.IMPLEMENTATION_TYPE_DELEGATEEXPRESSION);
            st.setImplementation("${wfAutoDecide}");
            addExtText(st, "autoDecision", "APPROVE");
            process.addFlowElement(st);
            return new Seg(nid, nid);
        }

        /**
         * 自动拒绝（autoReject）：serviceTask delegateExpression {@code ${wfAutoDecide}}（autoDecision=REJECT）
         * 记录 action=AUTO_REJECT 并把实例置 REJECTED，随后终止结束事件结束整实例。返回终止段（terminal=true）。
         */
        private Seg autoReject(JsonNode node) {
            String nid = sanitizeId(node.path("id").asString("autoreject_" + (++seq)));
            ServiceTask st = new ServiceTask();
            st.setId(nid);
            st.setName(node.path("name").asString("自动拒绝"));
            st.setImplementationType(ImplementationType.IMPLEMENTATION_TYPE_DELEGATEEXPRESSION);
            st.setImplementation("${wfAutoDecide}");
            addExtText(st, "autoDecision", "REJECT");
            process.addFlowElement(st);

            EndEvent term = new EndEvent();
            term.setId(nid + "_end");
            term.setName("自动拒绝结束");
            term.addEventDefinition(new TerminateEventDefinition());
            process.addFlowElement(term);
            addFlow(st.getId(), term.getId(), null);
            return new Seg(nid, term.getId(), true);
        }

        private String addFlow(String from, String to, String condition) {
            SequenceFlow flow = new SequenceFlow(from, to);
            String id = "flow_" + (++seq);
            flow.setId(id);
            if (StringUtils.hasText(condition)) {
                flow.setConditionExpression(condition);
            }
            process.addFlowElement(flow);
            return id;
        }

        /* ------------------------------------------------------------------
         * 自动布局：为所有流程节点生成 BPMNShape（GraphicInfo）+ 为每条 sequenceFlow
         * 生成 BPMNEdge（waypoints）。采用「最长路径分层 + 层内纵向错开」的从左到右布局，
         * 覆盖顺序节点、排它网关分支等 P1 图形，供前端 bpmn-js Viewer 渲染与高亮定位。
         * ------------------------------------------------------------------ */
        private static final double H_GAP = 60;
        private static final double V_GAP = 30;
        private static final double COL_WIDTH = 120; // 节点最大宽 + 间距的横向步长
        private static final double ROW_HEIGHT = 90;

        private void autoLayout(BpmnModel model) {
            List<FlowNode> flowNodes = new ArrayList<>();
            List<SequenceFlow> flows = new ArrayList<>();
            for (FlowElement el : process.getFlowElements()) {
                if (el instanceof SequenceFlow sf) {
                    flows.add(sf);
                } else if (el instanceof FlowNode fn) {
                    flowNodes.add(fn);
                }
            }
            // 邻接表
            Map<String, List<String>> succ = new LinkedHashMap<>();
            Map<String, Integer> indeg = new LinkedHashMap<>();
            for (FlowNode n : flowNodes) {
                succ.put(n.getId(), new ArrayList<>());
                indeg.put(n.getId(), 0);
            }
            for (SequenceFlow sf : flows) {
                if (succ.containsKey(sf.getSourceRef()) && indeg.containsKey(sf.getTargetRef())) {
                    succ.get(sf.getSourceRef()).add(sf.getTargetRef());
                    indeg.merge(sf.getTargetRef(), 1, Integer::sum);
                }
            }
            // 最长路径分层（拓扑序，层 = 前驱层 + 1）
            Map<String, Integer> layer = new LinkedHashMap<>();
            java.util.Deque<String> queue = new java.util.ArrayDeque<>();
            Map<String, Integer> indegWork = new LinkedHashMap<>(indeg);
            for (FlowNode n : flowNodes) {
                if (indegWork.get(n.getId()) == 0) {
                    layer.put(n.getId(), 0);
                    queue.add(n.getId());
                }
            }
            while (!queue.isEmpty()) {
                String u = queue.poll();
                int lu = layer.getOrDefault(u, 0);
                for (String v : succ.get(u)) {
                    layer.merge(v, lu + 1, Math::max);
                    if (indegWork.merge(v, -1, Integer::sum) == 0) {
                        queue.add(v);
                    }
                }
            }
            // 兜底：环或未覆盖节点给层 0
            for (FlowNode n : flowNodes) {
                layer.putIfAbsent(n.getId(), 0);
            }
            // 层内计数分配行
            Map<Integer, Integer> rowCursor = new LinkedHashMap<>();
            Map<String, GraphicInfo> shapes = new LinkedHashMap<>();
            for (FlowNode n : flowNodes) {
                int l = layer.get(n.getId());
                int row = rowCursor.merge(l, 1, Integer::sum) - 1;
                double[] wh = sizeOf(n);
                GraphicInfo gi = new GraphicInfo();
                gi.setWidth(wh[0]);
                gi.setHeight(wh[1]);
                double cx = 60 + l * (COL_WIDTH + H_GAP) + (COL_WIDTH - wh[0]) / 2;
                // 按「行中心线」垂直居中：不同高度的事件(30)/网关(40)/任务(60)中心对齐，
                // 连线为直线不带拐弯（此前按顶部对齐导致中心错位、连线抖动）。
                double rowCenterY = 60 + ROW_HEIGHT / 2 + row * (ROW_HEIGHT + V_GAP);
                double cy = rowCenterY - wh[1] / 2;
                gi.setX(cx);
                gi.setY(cy);
                shapes.put(n.getId(), gi);
                model.addGraphicInfo(n.getId(), gi);
            }
            // 边：源右中 → 目标左中
            for (SequenceFlow sf : flows) {
                GraphicInfo s = shapes.get(sf.getSourceRef());
                GraphicInfo t = shapes.get(sf.getTargetRef());
                if (s == null || t == null) {
                    continue;
                }
                GraphicInfo p1 = new GraphicInfo(s.getX() + s.getWidth(), s.getY() + s.getHeight() / 2);
                GraphicInfo p2 = new GraphicInfo(t.getX(), t.getY() + t.getHeight() / 2);
                List<GraphicInfo> way = new ArrayList<>();
                way.add(p1);
                int span = Math.abs(layer.getOrDefault(sf.getTargetRef(), 0) - layer.getOrDefault(sf.getSourceRef(), 0));
                if (span > 1 && Math.abs(p1.getY() - p2.getY()) <= 1) {
                    // 跨多列的旁路/默认分支边（如排它网关的跳过分支）：从下方绕行，
                    // 避免与同一行中间节点横穿重叠，读作一条清晰的「跳过」支路。
                    double dipY = Math.max(p1.getY(), p2.getY()) + ROW_HEIGHT;
                    way.add(new GraphicInfo(p1.getX(), dipY));
                    way.add(new GraphicInfo(p2.getX(), dipY));
                } else if (Math.abs(p1.getY() - p2.getY()) > 1) {
                    // 折线中转，避免斜穿
                    double midX = (p1.getX() + p2.getX()) / 2;
                    way.add(new GraphicInfo(midX, p1.getY()));
                    way.add(new GraphicInfo(midX, p2.getY()));
                }
                way.add(p2);
                model.addFlowGraphicInfoList(sf.getId(), way);
            }
        }

        /** 节点尺寸：事件 30x30，网关 40x40，任务/其它 100x60 */
        private double[] sizeOf(FlowNode n) {
            if (n instanceof StartEvent || n instanceof EndEvent) {
                return new double[]{30, 30};
            }
            if (n instanceof Gateway) {
                return new double[]{40, 40};
            }
            return new double[]{100, 60};
        }

        /**
         * P3 节点事件：把 events 数组存扩展元素 oa:events，并按 trigger 归类挂 taskListener
         * （create/complete/delete 三类生命周期），运行时由 {@code wfEventDelegate} 统一分发 NOTIFY/WEBHOOK/SCRIPT。
         */
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

        /** 18 种事件 trigger → Flowable 任务生命周期监听事件名。表单类/挂起类触发前端侧处理，此处不挂。 */
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
    }

    /** BPMN 元素 id 合法化：字母数字下划线，首字符非数字 */
    static String sanitizeId(String raw) {
        if (!StringUtils.hasText(raw)) {
            return "n";
        }
        String s = raw.replaceAll("[^A-Za-z0-9_]", "_");
        if (Character.isDigit(s.charAt(0))) {
            s = "n" + s;
        }
        return s;
    }

    /**
     * 一段子图的首尾元素 id。{@code terminal=true} 表示该段以终止结束事件收尾（如自动拒绝），
     * 其后不应再接后续流（否则从结束事件引出非法出边）。
     */
    private record Seg(String first, String last, boolean terminal) {
        static final Seg EMPTY = new Seg(null, null, false);

        Seg(String first, String last) {
            this(first, last, false);
        }

        boolean isEmpty() {
            return first == null || last == null;
        }
    }
}
