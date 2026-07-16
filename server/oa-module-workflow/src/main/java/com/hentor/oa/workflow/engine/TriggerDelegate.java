package com.hentor.oa.workflow.engine;

import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationContext;
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

/**
 * 触发节点统一入口（P3）：serviceTask delegateExpression {@code ${wfTriggerDelegate}}。
 * 读取节点扩展 triggerHandler / webhookUrl / triggerConfig：
 * - triggerHandler 命中注册的 {@link WfTrigger} bean → 调用其 execute（可写流程变量影响后续路由）；
 * - 否则 webhookUrl 非空 → 异步 POST 实例上下文（失败重试+日志，不阻塞流转）。
 * 执行完毕流程自动进入下一步（IMMEDIATE 立即；TIMER 由前置 timer 事件先等待）。
 */
@Slf4j
@Component("wfTriggerDelegate")
public class TriggerDelegate implements JavaDelegate {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).build();

    private final RepositoryService repositoryService;
    private final ObjectMapper objectMapper;
    private final ObjectProvider<ApplicationContext> contextProvider;

    public TriggerDelegate(RepositoryService repositoryService, ObjectMapper objectMapper,
                           ObjectProvider<ApplicationContext> contextProvider) {
        this.repositoryService = repositoryService;
        this.objectMapper = objectMapper;
        this.contextProvider = contextProvider;
    }

    @Override
    public void execute(DelegateExecution execution) {
        FlowElement fe = flowElement(execution);
        String handler = extText(fe, "triggerHandler");
        String webhookUrl = extText(fe, "webhookUrl");
        JsonNode config = extJson(fe, "triggerConfig");

        if (handler != null && !handler.isBlank()) {
            try {
                WfTrigger trigger = contextProvider.getObject().getBean(handler, WfTrigger.class);
                trigger.execute(execution, config);
                log.info("触发器 {} 执行完成 pid={}", handler, execution.getProcessInstanceId());
                return;
            } catch (Exception e) {
                log.warn("触发器 handler={} 执行失败 pid={}: {}", handler,
                        execution.getProcessInstanceId(), e.getMessage());
            }
        }
        if (webhookUrl != null && !webhookUrl.isBlank()) {
            postAsync(webhookUrl, execution);
        }
    }

    private void postAsync(String url, DelegateExecution execution) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("event", "TRIGGER");
        payload.put("procInstId", execution.getProcessInstanceId());
        payload.put("nodeId", execution.getCurrentActivityId());
        String body;
        try {
            body = objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            body = "{}";
        }
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        CLIENT.sendAsync(req, HttpResponse.BodyHandlers.discarding())
                .whenComplete((resp, ex) -> {
                    if (ex != null) {
                        log.warn("触发 WEBHOOK 投递失败 url={} err={}", url, ex.getMessage());
                    } else {
                        log.info("触发 WEBHOOK 投递完成 url={} status={}", url, resp.statusCode());
                    }
                });
    }

    private FlowElement flowElement(DelegateExecution execution) {
        try {
            return repositoryService.getBpmnModel(execution.getProcessDefinitionId())
                    .getMainProcess().getFlowElement(execution.getCurrentActivityId(), true);
        } catch (Exception e) {
            return null;
        }
    }

    private String extText(FlowElement fe, String name) {
        if (fe == null || fe.getExtensionElements() == null) {
            return null;
        }
        List<ExtensionElement> list = fe.getExtensionElements().get(name);
        if (list == null || list.isEmpty()) {
            return null;
        }
        String t = list.get(0).getElementText();
        return t == null || t.isBlank() ? null : t;
    }

    private JsonNode extJson(FlowElement fe, String name) {
        String text = extText(fe, name);
        if (text == null) {
            return null;
        }
        try {
            return objectMapper.readTree(text);
        } catch (Exception e) {
            return null;
        }
    }
}
