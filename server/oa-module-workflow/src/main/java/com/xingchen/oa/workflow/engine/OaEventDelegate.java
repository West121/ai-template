package com.xingchen.oa.workflow.engine;

import com.xingchen.oa.workflow.entity.WfInstanceExt;
import com.xingchen.oa.workflow.entity.WfNotify;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import com.xingchen.oa.workflow.support.WfAudit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.TaskListener;
import org.flowable.task.service.delegate.DelegateTask;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 节点事件统一分发入口（taskListener delegateExpression {@code ${wfEventDelegate}}）：
 * 读取节点扩展 oa:events，按当前任务生命周期事件(create/complete/delete)映射到 6 种真触发 trigger，
 * 逐条执行 action：NOTIFY(站内通知目标人)/WEBHOOK(异步 POST 外部)。SCRIPT 已下线。
 * 事件基建复用 P1/P2/P3：NOTIFY 走 {@link WfAudit}，WEBHOOK 沿用 fire-and-forget HTTP。
 */
@Slf4j
@Component("wfEventDelegate")
@RequiredArgsConstructor
public class OaEventDelegate implements TaskListener {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).build();

    private final RepositoryService repositoryService;
    private final WfInstanceExtRepository instanceRepository;
    private final AssigneeResolver assigneeResolver;
    private final WfAudit audit;
    private final ObjectMapper objectMapper;

    @Override
    public void notify(DelegateTask task) {
        try {
            Set<String> triggers = triggersFor(task.getEventName());
            if (triggers.isEmpty()) {
                return;
            }
            JsonNode events = nodeEvents(task.getProcessDefinitionId(), task.getTaskDefinitionKey());
            if (events == null || !events.isArray()) {
                return;
            }
            for (JsonNode ev : events) {
                if (triggers.contains(ev.path("trigger").asString(""))) {
                    dispatch(ev, task);
                }
            }
        } catch (Exception e) {
            log.warn("节点事件分发异常 task={}: {}", task.getId(), e.getMessage());
        }
    }

    private void dispatch(JsonNode ev, DelegateTask task) {
        String action = ev.path("action").asString("").toUpperCase();
        String pid = task.getProcessInstanceId();
        WfInstanceExt inst = instanceRepository.findByProcInstId(pid).orElse(null);
        String title = inst != null ? inst.getTitle() : task.getName();
        switch (action) {
            case "NOTIFY" -> {
                JsonNode notify = ev.path("notify");
                String template = notify.path("template").asString("流程「" + title + "」事件通知");
                List<Long> targets = assigneeResolver.resolveRefs(notify.path("to"));
                for (Long uid : targets) {
                    audit.notify(uid, WfNotify.TYPE_TODO, "流程通知：" + title, template, pid);
                }
                log.info("节点事件 NOTIFY 触发 node={} 目标{}人", task.getTaskDefinitionKey(), targets.size());
            }
            case "WEBHOOK" -> {
                String url = ev.path("webhookUrl").asString(null);
                if (url != null && !url.isBlank()) {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("event", "NODE_EVENT");
                    payload.put("trigger", ev.path("trigger").asString(""));
                    payload.put("procInstId", pid);
                    payload.put("nodeId", task.getTaskDefinitionKey());
                    payload.put("title", title);
                    postAsync(url, toJson(payload));
                }
            }
            default -> log.warn("未知/已下线节点事件 action: {}", action);
        }
    }

    private Set<String> triggersFor(String eventName) {
        if (eventName == null) {
            return Set.of();
        }
        return switch (eventName) {
            case "create" -> Set.of("TASK_AFTER_CREATED", "ACTIVITY_CONFIRM_PARTICIPANTS");
            case "complete" -> Set.of("TASK_BEFORE_COMPLETE", "TASK_AFTER_COMPLETE");
            case "delete" -> Set.of("TASK_BEFORE_UNDO", "TASK_AFTER_UNDO");
            default -> Set.of();
        };
    }

    private JsonNode nodeEvents(String procDefId, String nodeId) {
        try {
            FlowElement fe = repositoryService.getBpmnModel(procDefId).getMainProcess()
                    .getFlowElement(nodeId, true);
            if (fe == null || fe.getExtensionElements() == null) {
                return null;
            }
            List<ExtensionElement> list = fe.getExtensionElements().get("events");
            if (list == null || list.isEmpty()) {
                return null;
            }
            String text = list.get(0).getElementText();
            return (text == null || text.isBlank()) ? null : objectMapper.readTree(text);
        } catch (Exception e) {
            return null;
        }
    }

    private void postAsync(String url, String body) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(5))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            CLIENT.sendAsync(req, HttpResponse.BodyHandlers.discarding())
                    .whenComplete((resp, ex) -> {
                        if (ex != null) {
                            log.warn("节点事件 WEBHOOK 投递失败 url={}: {}", url, ex.getMessage());
                        }
                    });
        } catch (Exception e) {
            log.warn("节点事件 WEBHOOK 构造失败 url={}: {}", url, e.getMessage());
        }
    }

    private String toJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            return "{}";
        }
    }
}
