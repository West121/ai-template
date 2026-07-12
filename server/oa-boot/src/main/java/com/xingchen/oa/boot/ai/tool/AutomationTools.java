package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.service.AiInlineLlm;
import com.xingchen.oa.boot.ai.service.AiActionService;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.FlowRequest;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.FlowResponse;
import com.xingchen.oa.workflow.orch.service.OrchFlowService;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 亮点⑦「对话固化成自动化」（批E，附3）：自然语言周期/事件任务意图 → 编排草稿（OrchModel）→
 * FlowDraftCard（画布缩略 + 确认）→ 确认后建 <b>DRAFT</b> 编排（不启用/未发布），跳编排设计器微调启用。
 *
 * <p>模型只产结构化草稿（{@link AiInlineLlm#structured}，BeanOutputConverter 强校验 + 节点合法校验），
 * 不直接建流/启用。风险级 {@link AiToolRisk#EXPLICIT_UI_SUBMIT}——确认经动作草稿二段式
 * （POST /api/ai/actions/{id}/confirm）落 DRAFT 编排；坏草稿置 error 卡不建流。
 *
 * <p>复用既有引擎：{@link OrchFlowService#create}（enabled=false + version=0 天然 DRAFT，publish 才编译启用）。
 *
 * <p><b>FlowDraftCard 契约（给疾风）</b>：{@code {type:"flowDraft", draftId, name, triggerDesc,
 * nodes:[{type,label}]}}——draftId=动作草稿 id（确认端点入参）。确认响应
 * {@code data:{flowId, code, enabled:false, version:0, designerPath:"/automation/{code}/design"}}。
 */
@Component
@RequiredArgsConstructor
public class AutomationTools {

    /** 抽象/原生节点类型 → 编排原生组件类型（校验白名单；报表≈数据查询）。 */
    private static final Map<String, String> NODE_TYPES = Map.ofEntries(
            Map.entry("report", "dbQuery"), Map.entry("报表", "dbQuery"), Map.entry("dbQuery", "dbQuery"),
            Map.entry("notify", "notify"), Map.entry("通知", "notify"),
            Map.entry("http", "http"), Map.entry("llm", "llm"), Map.entry("delay", "delay"),
            Map.entry("script", "script"), Map.entry("dataMap", "dataMap"), Map.entry("respond", "respond"),
            Map.entry("dingtalkBot", "dingtalkBot"), Map.entry("feishuBot", "feishuBot"));

    private final AiToolSupport support;
    private final AiInlineLlm inlineLlm;
    private final AiActionService actionService;
    private final AiSessionHolder sessionHolder;
    private final OrchFlowService orchFlowService;
    private final ObjectMapper objectMapper;

    /** NL→编排草稿结构（BeanOutputConverter 目标 bean）。 */
    public record OrchFlowDraftSpec(String name, String triggerType, String cron,
                                    String eventSource, String eventType, String eventDefCode,
                                    List<OrchNodeSpec> nodes) {
    }

    public record OrchNodeSpec(String type, String label) {
    }

    @PostConstruct
    public void registerExecutors() {
        // 确认执行器（确认请求线程，UserContext=确认者）：建 DRAFT 编排（不启用/未发布）
        actionService.registerExecutor("orchestration_prepare_flow", params -> {
            FlowResponse resp = orchFlowService.create(new FlowRequest(
                    String.valueOf(params.get("code")), String.valueOf(params.get("name")),
                    String.valueOf(params.get("designerJson")),
                    params.get("triggerDesc") == null ? null : String.valueOf(params.get("triggerDesc")),
                    null));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("flowId", resp.id());
            out.put("code", resp.code());
            out.put("enabled", Boolean.TRUE.equals(resp.enabled()));
            out.put("version", resp.version());
            out.put("designerPath", "/automation/" + resp.code() + "/design");
            return out;
        });
    }

    @AiToolDefinition(name = "orchestration_prepare_flow",
            authorities = {"orch:flow:write"}, risk = AiToolRisk.EXPLICIT_UI_SUBMIT, timeoutSeconds = 30,
            description = "把「周期性/事件性任务」意图固化成一条自动化编排草稿（如每天定时出报表并通知、"
                    + "某审批发起时推送）。产画布缩略草稿卡，用户确认后建为草稿编排（不启用），再进设计器微调。"
                    + "参数 desc=自然语言意图描述，name 可选。",
            paramsSchema = "{\"desc\":{\"type\":\"string\",\"description\":\"自动化意图，如『每天早8点汇总昨日审批量并通知管理员』\"},"
                    + "\"name\":{\"type\":\"string\",\"description\":\"编排名称，可选\"}}",
            required = {"desc"})
    public ToolResult prepareFlow(Map<String, Object> args) {
        String desc = str(args.get("desc"));
        if (!StringUtils.hasText(desc)) {
            return err("AI_TOOL_INVALID_ARGUMENT", "请描述你想自动化的周期/事件任务");
        }
        OrchFlowDraftSpec spec = inlineLlm.structured(OrchFlowDraftSpec.class,
                "你是自动化编排规划器。触发方式 triggerType 取 CRON（周期，需 6 段 Spring cron，如 0 0 8 * * *）"
                        + "或 EVENT（事件，需 eventSource+eventType）；nodes 为触发后的处理节点（type 取 "
                        + "report/notify/http/llm/delay/script 等，label 为一句话）。只输出 JSON。",
                "根据以下自动化意图生成编排草稿：" + desc);
        if (spec == null) {
            return err("AI_DRAFT_UNAVAILABLE", "未能理解该自动化意图（模型不可用或描述过于笼统），请补充周期或触发事件");
        }

        // ---- 校验（坏草稿 → error 卡，不建流）----
        String triggerType = spec.triggerType() == null ? "" : spec.triggerType().trim().toUpperCase();
        ObjectNode trigger = objectMapper.createObjectNode();
        String triggerDesc;
        if ("CRON".equals(triggerType)) {
            String cron = str(spec.cron());
            if (!StringUtils.hasText(cron) || !CronExpression.isValidExpression(cron)) {
                return err("AI_DRAFT_INVALID", "定时表达式非法（需 Spring 6 段，如 0 0 8 * * *）：" + cron);
            }
            trigger.put("triggerType", "CRON").put("cron", cron);
            triggerDesc = "定时触发（CRON: " + cron + "）";
        } else if ("EVENT".equals(triggerType)) {
            String source = str(spec.eventSource());
            String type = str(spec.eventType());
            if (!StringUtils.hasText(source) || !StringUtils.hasText(type)) {
                return err("AI_DRAFT_INVALID", "事件触发缺少 eventSource/eventType");
            }
            ObjectNode ev = trigger.put("triggerType", "EVENT").putObject("event");
            ev.put("source", source).put("type", type);
            String defCode = str(spec.eventDefCode());
            if (StringUtils.hasText(defCode)) {
                ev.put("defCode", defCode);
            }
            triggerDesc = "事件触发（" + source + "/" + type + (StringUtils.hasText(defCode) ? "/" + defCode : "") + "）";
        } else {
            return err("AI_DRAFT_INVALID", "触发方式须为 CRON（周期）或 EVENT（事件），当前：" + spec.triggerType());
        }
        if (spec.nodes() == null || spec.nodes().isEmpty()) {
            return err("AI_DRAFT_INVALID", "编排草稿缺少处理节点（如报表/通知）");
        }
        List<Map<String, Object>> cardNodes = new java.util.ArrayList<>();
        List<String[]> nativeNodes = new java.util.ArrayList<>(); // [nativeType, label]
        for (OrchNodeSpec n : spec.nodes()) {
            String raw = n == null ? null : str(n.type());
            String label = n == null ? "" : str(n.label());
            String native0 = raw == null ? null : NODE_TYPES.get(raw);
            if (native0 == null) {
                return err("AI_DRAFT_INVALID", "不支持的编排节点类型：" + raw);
            }
            nativeNodes.add(new String[]{native0, label == null ? "" : label});
            Map<String, Object> cn = new LinkedHashMap<>();
            cn.put("type", native0);
            cn.put("label", label == null ? "" : label);
            cardNodes.add(cn);
        }

        // ---- 组装 OrchModel（trigger → 节点链 → end；线性 edges，DRAFT 不编译）----
        String name = StringUtils.hasText(str(spec.name())) ? str(spec.name())
                : (StringUtils.hasText(str(args.get("name"))) ? str(args.get("name")) : "自动化-" + triggerDesc);
        String designerJson = buildDesignerJson(name, trigger, nativeNodes);
        String code = "aiflow" + Long.toString(System.currentTimeMillis(), 36)
                + Integer.toString((int) (Math.random() * 1000));

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("code", code);
        params.put("name", name);
        params.put("designerJson", designerJson);
        params.put("triggerDesc", triggerDesc);
        String draftId = stage("orchestration_prepare_flow", "ORCH_FLOW_CREATE", params);

        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "flowDraft");
        card.put("draftId", draftId);
        card.put("name", name);
        card.put("triggerDesc", triggerDesc);
        card.put("nodes", cardNodes);
        return ToolResult.of(support.toJson(Map.of("staged", true, "draftId", draftId, "name", name,
                "triggerDesc", triggerDesc, "note", "已生成自动化草稿卡，确认后建为草稿编排（不启用）")), card);
    }

    /** trigger + 处理节点 → OrchModel designerJson（含线性 edges + end）。 */
    private String buildDesignerJson(String name, ObjectNode trigger, List<String[]> nodes) {
        ObjectNode model = objectMapper.createObjectNode();
        model.put("schemaVersion", 1);
        model.put("name", name);
        ArrayNode nodeArr = model.putArray("nodes");
        ArrayNode edgeArr = model.putArray("edges");

        ObjectNode tNode = nodeArr.addObject();
        tNode.put("id", "trigger").put("type", "trigger").put("name", "触发").set("config", trigger);
        String prev = "trigger";
        int i = 0;
        for (String[] n : nodes) {
            String id = "n" + (++i);
            ObjectNode node = nodeArr.addObject();
            node.put("id", id).put("type", n[0]).put("name", StringUtils.hasText(n[1]) ? n[1] : n[0]);
            node.set("config", nodeConfig(n[0], n[1]));
            edgeArr.addObject().put("id", "e" + i).put("source", prev).put("target", id);
            prev = id;
        }
        ObjectNode end = nodeArr.addObject();
        end.put("id", "end").put("type", "end").put("name", "结束").putObject("config");
        edgeArr.addObject().put("id", "eEnd").put("source", prev).put("target", "end");
        return model.toString();
    }

    /** 各节点最小可编辑 config（进设计器后用户补全）。 */
    private ObjectNode nodeConfig(String type, String label) {
        ObjectNode c = objectMapper.createObjectNode();
        if ("notify".equals(type)) {
            c.putArray("recipients");
            c.put("title", StringUtils.hasText(label) ? label : "自动化通知");
            c.put("content", StringUtils.hasText(label) ? label : "");
        }
        return c;
    }

    private String stage(String toolName, String actionType, Map<String, Object> params) {
        AiSessionHolder.Turn turn = sessionHolder.currentTurn();
        return actionService.stage(turn != null ? turn.sessionId() : null,
                turn != null ? turn.messageId() : null, toolName, actionType, params, null);
    }

    private ToolResult err(String code, String message) {
        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "error");
        card.put("code", code);
        card.put("message", message);
        return ToolResult.of(support.toJson(Map.of("error", code + ": " + message)), card);
    }

    private String str(Object v) {
        return v == null || !StringUtils.hasText(String.valueOf(v)) ? null : String.valueOf(v).trim();
    }
}
