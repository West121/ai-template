package com.xingchen.oa.workflow.engine;

import com.xingchen.oa.workflow.engine.script.ScriptContext;
import com.xingchen.oa.workflow.engine.script.ScriptService;
import com.xingchen.oa.workflow.entity.WfInstanceExt;
import com.xingchen.oa.workflow.entity.WfNotify;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import com.xingchen.oa.workflow.support.WfAudit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.Process;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.ExecutionListener;
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
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiConsumer;

/**
 * 事件统一分发入口（delegateExpression {@code ${wfEventDelegate}}），同时实现两类监听器：
 * <ul>
 *   <li><b>节点事件</b>（{@link TaskListener}）：转换器 {@code GraphToBpmnConverter.addNodeEvents} 按 trigger 挂
 *       taskListener（create/complete/delete）；本类读节点扩展 {@code oa:events}，按当前任务生命周期映射到 6 种真触发
 *       trigger 逐条执行。</li>
 *   <li><b>流程事件</b>（{@link ExecutionListener}）：转换器把 {@code flowConfig.events}（ProcessEvent[]）挂成
 *       <b>流程级 executionListener</b>（process start/end）；本类读进程扩展 {@code oa:flowConfig.events}，按
 *       PROCESS_START/PROCESS_END 逐条执行。（PROCESS_CANCEL 暂无可靠 process-level 落点，见转换器 TODO。）</li>
 * </ul>
 *
 * <p>动作（NodeEvent / ProcessEvent 共用 {@code EventActionConfig}，与前端契约对齐）：
 * <ul>
 *   <li><b>NOTIFY</b>：站内通知目标人（notify.template 为内容），走 {@link WfAudit}。</li>
 *   <li><b>WEBHOOK</b>：异步 POST 外部 URL（实例上下文 JSON），fire-and-forget。</li>
 *   <li><b>SCRIPT</b>：读 {@code script{lang,code}}，注入当前流程变量（vars/form/execution）交 {@link ScriptService}
 *       执行，脚本对 {@code vars} 的增改回写为流程变量。</li>
 *   <li><b>API</b>：按 {@code api{method,url,headers,body}} 发完整 HTTP（headers 文本逐行 {@code Name: Value} 解析、
 *       body 原样发），异步 fire-and-forget。</li>
 * </ul>
 *
 * <p><b>容错</b>：单个事件动作失败（脚本异常/超时、HTTP 失败、通知失败）只记日志/审计（脚本审计落
 * {@code wf_script_exec_log}），不让监听器异常炸掉主流程；每个事件独立 try/catch，互不影响。
 * 节点 SCRIPT 走 taskListener 无独立 {@link DelegateExecution}（{@code execution} 绑定为 null，脚本用 vars/form），
 * 变量回写经 {@code task.setVariable}；流程 SCRIPT 有 execution，绑定完整。
 */
@Slf4j
@Component("wfEventDelegate")
@RequiredArgsConstructor
public class OaEventDelegate implements TaskListener, ExecutionListener {

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).build();

    private final RepositoryService repositoryService;
    private final WfInstanceExtRepository instanceRepository;
    private final AssigneeResolver assigneeResolver;
    private final WfAudit audit;
    private final ObjectMapper objectMapper;
    private final ScriptService scriptService;

    /* ==================== 节点事件（taskListener create/complete/delete） ==================== */

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
            String pid = task.getProcessInstanceId();
            String title = titleOf(pid, task.getName());
            Map<String, Object> vars = safeVars(task.getVariables());
            String label = task.getTaskDefinitionKey();
            for (JsonNode ev : events) {
                if (triggers.contains(ev.path("trigger").asString(""))) {
                    // taskListener 无独立 DelegateExecution：execution=null，变量回写走 task.setVariable
                    safeDispatch(ev, pid, label, title, vars, task::setVariable, null);
                }
            }
        } catch (Exception e) {
            log.warn("节点事件分发异常 task={}: {}", task.getId(), e.getMessage());
        }
    }

    /* ==================== 流程事件（executionListener，挂 process start/end） ==================== */

    @Override
    public void notify(DelegateExecution execution) {
        try {
            Set<String> triggers = processTriggersFor(execution.getEventName());
            if (triggers.isEmpty()) {
                return;
            }
            JsonNode events = processEvents(execution.getProcessDefinitionId());
            if (events == null || !events.isArray()) {
                return;
            }
            String pid = execution.getProcessInstanceId();
            Object varTitle = execution.getVariable("wfInstanceTitle");
            String title = titleOf(pid, varTitle != null ? varTitle.toString() : pid);
            Map<String, Object> vars = safeVars(execution.getVariables());
            for (JsonNode ev : events) {
                if (triggers.contains(ev.path("trigger").asString(""))) {
                    safeDispatch(ev, pid, "PROCESS", title, vars, execution::setVariable, execution);
                }
            }
        } catch (Exception e) {
            log.warn("流程事件分发异常 pid={}: {}", execution.getProcessInstanceId(), e.getMessage());
        }
    }

    /* ==================== 动作分发 ==================== */

    /** 单事件动作独立容错：一条失败只记日志，不影响其余事件、不炸主流程。 */
    private void safeDispatch(JsonNode ev, String pid, String label, String title,
                              Map<String, Object> vars, BiConsumer<String, Object> writer,
                              DelegateExecution execution) {
        try {
            dispatch(ev, pid, label, title, vars, writer, execution);
        } catch (Exception e) {
            log.warn("事件动作执行失败 action={} label={} pid={}: {}",
                    ev.path("action").asString(""), label, pid, e.getMessage());
        }
    }

    private void dispatch(JsonNode ev, String pid, String label, String title,
                          Map<String, Object> vars, BiConsumer<String, Object> writer,
                          DelegateExecution execution) {
        String action = ev.path("action").asString("").toUpperCase();
        switch (action) {
            case "NOTIFY" -> {
                JsonNode notify = ev.path("notify");
                String template = notify.path("template").asString("流程「" + title + "」事件通知");
                List<Long> targets = assigneeResolver.resolveRefs(notify.path("to"));
                for (Long uid : targets) {
                    audit.notify(uid, WfNotify.TYPE_TODO, "流程通知：" + title, template, pid);
                }
                log.info("事件 NOTIFY 触发 {} 目标{}人", label, targets.size());
            }
            case "WEBHOOK" -> {
                String url = ev.path("webhookUrl").asString(null);
                if (url != null && !url.isBlank()) {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("event", "PROCESS".equals(label) ? "PROCESS_EVENT" : "NODE_EVENT");
                    payload.put("trigger", ev.path("trigger").asString(""));
                    payload.put("procInstId", pid);
                    payload.put("nodeId", label);
                    payload.put("title", title);
                    postAsync(url, toJson(payload));
                }
            }
            case "SCRIPT" -> runScript(ev, pid, label, vars, writer, execution);
            case "API" -> runApi(ev, label);
            default -> log.warn("未知/不支持事件 action: {}", action);
        }
    }

    /**
     * SCRIPT 动作：注入当前流程变量（vars/form）+ 可选 execution 交 {@link ScriptService} 执行，
     * 脚本对 vars 的增改回写为流程变量（供后续网关路由/表单）。脚本异常/超时由 ScriptService 抛
     * BusinessException（已落审计），在 {@link #safeDispatch} 兜底记录，不炸主流程。
     */
    private void runScript(JsonNode ev, String pid, String label, Map<String, Object> vars,
                           BiConsumer<String, Object> writer, DelegateExecution execution) {
        JsonNode s = ev.path("script");
        String lang = s.path("lang").asString("");
        String code = s.path("code").asString("");
        if (lang.isBlank() || code.isBlank()) {
            log.warn("事件 SCRIPT 缺少 lang/code，跳过 {} pid={}", label, pid);
            return;
        }
        Map<String, Object> scriptVars = new HashMap<>(vars);
        Map<String, Object> form = new HashMap<>(vars);
        String scriptRef = pid + "#" + label + "#event";
        scriptService.run(lang, code, new ScriptContext(scriptVars, form, execution, scriptRef));
        // 回写脚本对 vars 的增改为流程变量（影响后续网关/表单）
        for (Map.Entry<String, Object> e : scriptVars.entrySet()) {
            Object before = vars.get(e.getKey());
            if (before == null ? e.getValue() != null : !before.equals(e.getValue())) {
                writer.accept(e.getKey(), e.getValue());
            }
        }
        log.info("事件 SCRIPT 执行完成 {} pid={} lang={}", label, pid, lang);
    }

    /** API 动作：按 {@code {method,url,headers,body}} 发完整 HTTP，异步 fire-and-forget，失败记日志。 */
    private void runApi(JsonNode ev, String label) {
        JsonNode api = ev.path("api");
        String url = api.path("url").asString(null);
        if (url == null || url.isBlank()) {
            log.warn("事件 API 缺少 url，跳过 {}", label);
            return;
        }
        String method = api.path("method").asString("POST");
        String headers = api.path("headers").asString("");
        String body = api.path("body").asString(null);
        sendApi(method, url, headers, body, label);
    }

    /* ==================== trigger 映射 ==================== */

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

    private Set<String> processTriggersFor(String eventName) {
        if (eventName == null) {
            return Set.of();
        }
        return switch (eventName) {
            case "start" -> Set.of("PROCESS_START");
            case "end" -> Set.of("PROCESS_END");
            // PROCESS_CANCEL：process-level end 监听无法区分正常结束/撤销终止，转换器未挂（TODO 见 GraphToBpmnConverter）
            default -> Set.of();
        };
    }

    /* ==================== 扩展元素读取 ==================== */

    /** 节点扩展 {@code oa:events}（整条 NodeEvent[] JSON）。 */
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

    /** 流程扩展 {@code oa:flowConfig.events}（ProcessEvent[]）。 */
    private JsonNode processEvents(String procDefId) {
        try {
            Process proc = repositoryService.getBpmnModel(procDefId).getMainProcess();
            if (proc == null || proc.getExtensionElements() == null) {
                return null;
            }
            List<ExtensionElement> list = proc.getExtensionElements().get("flowConfig");
            if (list == null || list.isEmpty()) {
                return null;
            }
            String text = list.get(0).getElementText();
            if (text == null || text.isBlank()) {
                return null;
            }
            JsonNode events = objectMapper.readTree(text).path("events");
            return events.isArray() ? events : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String titleOf(String pid, String fallback) {
        WfInstanceExt inst = instanceRepository.findByProcInstId(pid).orElse(null);
        return inst != null ? inst.getTitle() : fallback;
    }

    private Map<String, Object> safeVars(Map<String, Object> v) {
        return v == null ? new HashMap<>() : v;
    }

    /* ==================== HTTP ==================== */

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
                            log.warn("事件 WEBHOOK 投递失败 url={}: {}", url, ex.getMessage());
                        }
                    });
        } catch (Exception e) {
            log.warn("事件 WEBHOOK 构造失败 url={}: {}", url, e.getMessage());
        }
    }

    /**
     * API 动作 HTTP 发送。headers 文本逐行 {@code Name: Value}（亦容忍 {@code Name=Value}）解析；
     * GET/无 body 的 DELETE 不带请求体，PUT/POST 带 body。异步 fire-and-forget，失败记日志（容错）。
     */
    private void sendApi(String method, String url, String headersText, String body, String label) {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(5));
            applyHeaders(b, headersText);
            HttpRequest.BodyPublisher pub = (body == null || body.isEmpty())
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(body);
            String m = method == null ? "POST" : method.trim().toUpperCase();
            switch (m) {
                case "GET" -> b.GET();
                case "DELETE" -> {
                    if (body == null || body.isEmpty()) {
                        b.DELETE();
                    } else {
                        b.method("DELETE", pub);
                    }
                }
                case "PUT" -> b.PUT(pub);
                default -> b.POST(pub); // POST 及未知回退 POST
            }
            HttpRequest req = b.build();
            CLIENT.sendAsync(req, HttpResponse.BodyHandlers.discarding())
                    .whenComplete((resp, ex) -> {
                        if (ex != null) {
                            log.warn("事件 API 调用失败 {} {} url={}: {}", label, m, url, ex.getMessage());
                        } else {
                            log.info("事件 API 调用完成 {} {} url={} status={}", label, m, url, resp.statusCode());
                        }
                    });
        } catch (Exception e) {
            log.warn("事件 API 构造失败 url={}: {}", url, e.getMessage());
        }
    }

    /** 逐行解析 headers 文本（首个 {@code :} 或 {@code =} 分隔）；JDK 受限头名抛异常时跳过该行不中断。 */
    private void applyHeaders(HttpRequest.Builder b, String headersText) {
        if (headersText == null || headersText.isBlank()) {
            return;
        }
        for (String line : headersText.split("\\r?\\n")) {
            String s = line.trim();
            if (s.isEmpty()) {
                continue;
            }
            int idx = s.indexOf(':');
            if (idx < 0) {
                idx = s.indexOf('=');
            }
            if (idx <= 0) {
                continue;
            }
            String k = s.substring(0, idx).trim();
            String v = s.substring(idx + 1).trim();
            if (k.isEmpty()) {
                continue;
            }
            try {
                b.header(k, v);
            } catch (IllegalArgumentException ignore) {
                // JDK HttpClient 受限头（Host/Content-Length/Connection 等）不可手设，跳过
                log.debug("事件 API 跳过受限/非法请求头: {}", k);
            }
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
