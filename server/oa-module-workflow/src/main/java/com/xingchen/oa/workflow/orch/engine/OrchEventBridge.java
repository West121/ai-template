package com.xingchen.oa.workflow.orch.engine;

import com.xingchen.oa.workflow.entity.WfInstanceExt;
import com.xingchen.oa.workflow.orch.entity.OrchExec;
import com.xingchen.oa.workflow.orch.entity.OrchFlow;
import com.xingchen.oa.workflow.orch.repository.OrchFlowRepository;
import com.xingchen.oa.workflow.orch.service.OrchExecService;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
import org.flowable.common.engine.api.delegate.event.FlowableEntityEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEventListener;
import org.flowable.common.engine.api.delegate.event.FlowableEventType;
import org.flowable.engine.HistoryService;
import org.flowable.task.api.Task;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 编排事件桥（触发器之三）：桥接共享 Flowable 引擎事件 → 匹配订阅（trigger_config.event
 * {source, type, defCode?}）的 enabled+已发布编排，payload=事件上下文。
 *
 * <p><b>事件目录 / payload 形状</b>（文档化契约，前后端一致）：
 * <ul>
 *   <li>source=WF：type=INSTANCE_COMPLETED（实例完成）/ TASK_COMPLETED（任一任务办结）</li>
 *   <li>source=GONGWEN：type=ISSUED(签发)/SEALED(用印)/PUBLISHED(成文)/FINISHED(收文办结)
 *       ——由 gw_send/gw_recv 对应稳定节点任务办结映射</li>
 * </ul>
 * payload = { source, type, defCode, procInstId, title?, initiatorId?, initiatorName?,
 * nodeId?, nodeName?(任务事件), businessKey?, documentId?(GONGWEN，businessKey GW:{id} 解出) }。
 *
 * <p><b>防自触发死循环</b>：编排 startApproval 起的实例带流程变量 __orchDepth；事件桥读到 ≥2 直接跳过；
 * 触发的 exec 继承该深度（其内 startApproval/subFlow 继续 +1），链条有界。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OrchEventBridge implements FlowableEventListener {

    private static final int MAX_EVENT_DEPTH = 2;
    /** gongwen 稳定节点 → GONGWEN 事件类型（回写 hook 同源，节点 id 锁定不改）。 */
    private static final Map<String, String> GONGWEN_EVENTS = Map.of(
            "issue", "ISSUED", "seal", "SEALED", "publish", "PUBLISHED", "finish", "FINISHED");

    private final OrchFlowRepository flowRepository;
    private final WfInstanceExtRepository instanceRepository;
    private final ObjectMapper objectMapper;
    /** 懒解析：避免 processEngine ↔ 全局监听器装配环。 */
    private final ObjectProvider<OrchExecService> execServiceProvider;
    private final ObjectProvider<HistoryService> historyServiceProvider;

    @Override
    public void onEvent(FlowableEvent event) {
        if (!(event.getType() instanceof FlowableEngineEventType type)) {
            return;
        }
        try {
            switch (type) {
                case TASK_COMPLETED -> onTaskCompleted(event);
                case PROCESS_COMPLETED -> onProcessCompleted(event);
                default -> {
                }
            }
        } catch (Exception e) {
            log.warn("编排事件桥处理异常 type={}: {}", type, e.getMessage());
        }
    }

    private void onProcessCompleted(FlowableEvent event) {
        if (!(event instanceof FlowableEngineEvent ee) || ee.getProcessInstanceId() == null) {
            return;
        }
        String pid = ee.getProcessInstanceId();
        String defKey = defKey(ee.getProcessDefinitionId());
        Map<String, Object> payload = basePayload("WF", "INSTANCE_COMPLETED", defKey, pid);
        fire("WF", "INSTANCE_COMPLETED", defKey, payload, pid);
    }

    private void onTaskCompleted(FlowableEvent event) {
        if (!(event instanceof FlowableEntityEvent ee) || !(ee.getEntity() instanceof Task task)) {
            return;
        }
        String pid = task.getProcessInstanceId();
        String defKey = defKey(task.getProcessDefinitionId());
        Map<String, Object> payload = basePayload("WF", "TASK_COMPLETED", defKey, pid);
        payload.put("nodeId", task.getTaskDefinitionKey());
        payload.put("nodeName", task.getName());
        fire("WF", "TASK_COMPLETED", defKey, payload, pid);

        // GONGWEN 语义事件：gw_send/gw_recv 稳定节点映射
        String gwType = GONGWEN_EVENTS.get(task.getTaskDefinitionKey());
        if (gwType != null && ("gw_send".equals(defKey) || "gw_recv".equals(defKey))) {
            Map<String, Object> gwPayload = new LinkedHashMap<>(payload);
            gwPayload.put("source", "GONGWEN");
            gwPayload.put("type", gwType);
            fire("GONGWEN", gwType, defKey, gwPayload, pid);
        }
    }

    /** 匹配订阅并触发（深度护栏在此收口）。 */
    private void fire(String source, String type, String defKey, Map<String, Object> payload, String pid) {
        List<OrchFlow> candidates = flowRepository.findByEnabledTrueAndTriggerType(OrchFlow.TRIGGER_EVENT);
        if (candidates.isEmpty()) {
            return;
        }
        int depth = orchDepth(pid);
        if (depth >= MAX_EVENT_DEPTH) {
            log.info("编排事件桥：实例 {} 编排深度 {} 达上限，跳过触发（防死循环）", pid, depth);
            return;
        }
        for (OrchFlow flow : candidates) {
            JsonNode sub = parse(flow.getTriggerConfig());
            if (sub == null) {
                continue;
            }
            if (!source.equalsIgnoreCase(sub.path("source").asString(""))
                    || !type.equalsIgnoreCase(sub.path("type").asString(""))) {
                continue;
            }
            String subDef = sub.path("defCode").asString(null);
            if (subDef != null && !subDef.isBlank() && !subDef.equals(defKey)) {
                continue;
            }
            try {
                execServiceProvider.getObject().trigger(flow, payload, OrchExec.KIND_EVENT, depth);
                log.info("编排事件桥：{}/{} 触发编排 {}", source, type, flow.getCode());
            } catch (Exception e) {
                log.warn("编排事件触发失败 flow={}: {}", flow.getCode(), e.getMessage());
            }
        }
    }

    private Map<String, Object> basePayload(String source, String type, String defKey, String pid) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("source", source);
        p.put("type", type);
        p.put("defCode", defKey);
        p.put("procInstId", pid);
        WfInstanceExt inst = instanceRepository.findByProcInstId(pid).orElse(null);
        if (inst != null) {
            p.put("title", inst.getTitle());
            p.put("initiatorId", inst.getInitiatorId());
            p.put("initiatorName", inst.getInitiatorName());
        }
        String businessKey = businessKey(pid);
        if (businessKey != null) {
            p.put("businessKey", businessKey);
            if (businessKey.startsWith("GW:")) {
                p.put("documentId", businessKey.substring(3));
            }
        }
        return p;
    }

    /** 实例的编排深度标记（startApproval 写入 __orchDepth；普通实例无 → 0）。 */
    private int orchDepth(String pid) {
        try {
            var v = historyServiceProvider.getObject().createHistoricVariableInstanceQuery()
                    .processInstanceId(pid).variableName("__orchDepth").singleResult();
            return v != null && v.getValue() instanceof Number n ? n.intValue() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private String businessKey(String pid) {
        try {
            var hpi = historyServiceProvider.getObject().createHistoricProcessInstanceQuery()
                    .processInstanceId(pid).singleResult();
            return hpi != null ? hpi.getBusinessKey() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String defKey(String procDefId) {
        if (procDefId == null) {
            return null;
        }
        return procDefId.contains(":") ? procDefId.substring(0, procDefId.indexOf(':')) : procDefId;
    }

    private JsonNode parse(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public boolean isFailOnException() {
        return false;
    }

    @Override
    public boolean isFireOnTransactionLifecycleEvent() {
        return false;
    }

    @Override
    public String getOnTransaction() {
        return null;
    }

    @Override
    public Collection<? extends FlowableEventType> getTypes() {
        return List.of(FlowableEngineEventType.TASK_COMPLETED, FlowableEngineEventType.PROCESS_COMPLETED);
    }
}
