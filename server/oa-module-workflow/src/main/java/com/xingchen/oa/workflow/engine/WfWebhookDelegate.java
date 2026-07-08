package com.xingchen.oa.workflow.engine;

import com.xingchen.oa.workflow.entity.WfInstanceExt;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * WEBHOOK 事件（serviceTask delegateExpression {@code ${wfWebhookDelegate}}）：
 * 读取节点扩展 webhookUrl，异步 POST 实例上下文 JSON（fire-and-forget，失败重试一次 + 日志，不阻塞流转）。
 */
@Slf4j
@Component("wfWebhookDelegate")
@RequiredArgsConstructor
public class WfWebhookDelegate implements JavaDelegate {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).build();

    private final RepositoryService repositoryService;
    private final WfInstanceExtRepository instanceRepository;
    private final ObjectMapper objectMapper;

    @Override
    public void execute(DelegateExecution execution) {
        String pid = execution.getProcessInstanceId();
        String nodeId = execution.getCurrentActivityId();
        String url = webhookUrl(execution.getProcessDefinitionId(), nodeId);
        if (url == null || url.isBlank()) {
            return;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("event", "WEBHOOK");
        payload.put("procInstId", pid);
        payload.put("nodeId", nodeId);
        WfInstanceExt inst = instanceRepository.findByProcInstId(pid).orElse(null);
        if (inst != null) {
            payload.put("defCode", inst.getDefCode());
            payload.put("title", inst.getTitle());
            payload.put("bizStatus", inst.getBizStatus());
        }
        String body;
        try {
            body = objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            body = "{}";
        }
        post(url, body, 1);
    }

    /** 异步投递（不阻塞引擎事务）；失败按剩余次数重试。 */
    private void post(String url, String body, int retriesLeft) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        CLIENT.sendAsync(req, HttpResponse.BodyHandlers.discarding())
                .whenComplete((resp, ex) -> {
                    if (ex != null) {
                        log.warn("WEBHOOK 投递失败 url={} err={}", url, ex.getMessage());
                        if (retriesLeft > 0) {
                            post(url, body, retriesLeft - 1);
                        }
                    } else {
                        log.info("WEBHOOK 投递完成 url={} status={}", url, resp.statusCode());
                    }
                });
    }

    private String webhookUrl(String procDefId, String nodeId) {
        try {
            FlowElement fe = repositoryService.getBpmnModel(procDefId).getMainProcess()
                    .getFlowElement(nodeId, true);
            if (fe == null || fe.getExtensionElements() == null) {
                return null;
            }
            List<ExtensionElement> list = fe.getExtensionElements().get("webhookUrl");
            return (list == null || list.isEmpty()) ? null : list.get(0).getElementText();
        } catch (Exception e) {
            return null;
        }
    }
}
