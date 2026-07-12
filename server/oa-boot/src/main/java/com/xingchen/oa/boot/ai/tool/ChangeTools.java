package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.service.AiActionService;
import com.xingchen.oa.boot.ai.service.AiApprovalInsightService;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import com.xingchen.oa.office.dto.MeetingCreateRequest;
import com.xingchen.oa.office.dto.ScheduleCreateRequest;
import com.xingchen.oa.office.service.MeetingService;
import com.xingchen.oa.office.service.ScheduleService;
import com.xingchen.oa.workflow.dto.ProcessDefResponse;
import com.xingchen.oa.workflow.dto.RejectRequest;
import com.xingchen.oa.workflow.dto.TaskActionRequest;
import com.xingchen.oa.workflow.entity.WfFormDef;
import com.xingchen.oa.workflow.entity.WfProcessExt;
import com.xingchen.oa.workflow.repository.WfFormDefRepository;
import com.xingchen.oa.workflow.service.ProcessDefService;
import com.xingchen.oa.workflow.service.WfTaskService;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 变更工具（§4/V2 §7）：一律 Prepare→Confirm→Execute——工具只产 confirm/form 卡，动作草稿经
 * {@link AiActionService} 持久化到 ai_action_draft（PENDING_CONFIRM）；用户确认
 * → POST /api/ai/actions/{id}/confirm 执行注册的执行器（底层 Service 权限二验 + TOCTOU 预检）。
 * start_approval 产 form 卡（表单直提交走既有 /api/wf/instances，不经 LLM）。
 */
@Component
@RequiredArgsConstructor
public class ChangeTools {

    private final AiToolSupport support;
    private final AiActionService actionService;
    private final AiSessionHolder sessionHolder;
    private final ObjectMapper objectMapper;
    private final AiApprovalInsightService insightService;

    private final ProcessDefService processDefService;
    private final WfFormDefRepository formDefRepository;
    private final WfTaskService taskService;
    private final ScheduleService scheduleService;
    private final MeetingService meetingService;

    /** 注册确认执行器（confirm 时在确认请求线程执行，UserContext=确认者 → 权限二验生效）。 */
    @PostConstruct
    public void registerExecutors() {
        actionService.registerExecutor("approve_task", params -> {
            String taskId = String.valueOf(params.get("taskId"));
            String decision = String.valueOf(params.getOrDefault("decision", "APPROVE")).toUpperCase();
            String comment = params.get("comment") == null ? null : String.valueOf(params.get("comment"));
            if ("REJECT".equals(decision)) {
                taskService.reject(taskId, new RejectRequest(
                        StringUtils.hasText(comment) ? comment : "驳回", null, null, null));
            } else {
                taskService.approve(taskId, new TaskActionRequest(comment, null, null));
            }
            return Map.of("taskId", taskId, "decision", decision);
        });
        actionService.registerExecutor("create_schedule", params ->
                scheduleService.create(new ScheduleCreateRequest(
                        String.valueOf(params.get("title")),
                        LocalDate.parse(String.valueOf(params.get("date"))),
                        strOrNull(params, "startTime"), strOrNull(params, "endTime"),
                        strOrNull(params, "place"),
                        String.valueOf(params.getOrDefault("type", "OTHER")))));
        actionService.registerExecutor("create_meeting", params ->
                meetingService.create(new MeetingCreateRequest(
                        asLong(params.get("roomId")), String.valueOf(params.get("subject")),
                        LocalDate.parse(String.valueOf(params.get("date"))),
                        asInt(params.get("startHour")), asInt(params.get("endHour")))));
    }

    /** 暂存动作草稿（当前轮次 session/message 绑定；target=TOCTOU 快照，可空）。 */
    private String stage(String toolName, String actionType, Map<String, Object> params,
                         AiActionService.Target target) {
        AiSessionHolder.Turn turn = sessionHolder.currentTurn();
        return actionService.stage(turn != null ? turn.sessionId() : null,
                turn != null ? turn.messageId() : null, toolName, actionType, params, target);
    }

    @AiToolDefinition(name = "workflow_prepare_start", aliases = {"start_approval"},
            description = "发起一个审批流程：返回对话内表单卡（在线表单内嵌填写 / 代码表单跳转）。参数 defCode=流程编码（如 leave_approval）。",
            paramsSchema = "{\"defCode\":{\"type\":\"string\",\"description\":\"流程定义编码，如 leave_approval\"}}",
            required = {"defCode"})
    public ToolResult startApproval(Map<String, Object> args) {
        String defCode = String.valueOf(args.get("defCode"));
        ProcessDefResponse def = processDefService.latest(defCode); // 不存在 → 404 转 error 数据帧
        String formType = def.formType(); // 已归一化 ONLINE|CODE
        Object schema = null;
        String submitPath = null;
        if (WfProcessExt.FORM_CODE.equals(formType)) {
            submitPath = def.formSubmitPath();
        } else if (StringUtils.hasText(def.formCode())) {
            WfFormDef form = formDefRepository.findTopByCodeOrderByVersionDesc(def.formCode()).orElse(null);
            if (form != null && StringUtils.hasText(form.getSchemaJson())) {
                try {
                    // 批C 契约对账：form 卡 schema 固定为 widgets 数组（FormSchema 对象 → 取 widgets；
                    // 历史顶层数组原样），不做对象包裹/JSON 字符串——api-contract 已写明
                    var root = objectMapper.readTree(form.getSchemaJson());
                    schema = root.isArray() ? root
                            : (root.path("widgets").isArray() ? root.path("widgets") : null);
                } catch (Exception ignored) {
                    // schema 解析失败 → 前端回退跳转发起页
                }
            }
        }
        Map<String, Object> card = support.formCard(defCode, def.name(), formType, schema, submitPath);
        return ToolResult.of(support.toJson(Map.of("defCode", defCode, "name", def.name(),
                "formType", formType, "hint", "已在对话中展示表单卡，请填写后提交")), card);
    }

    @AiToolDefinition(name = "task_prepare_approve", aliases = {"approve_task"},
            authorities = {"office:approval:approve"}, risk = AiToolRisk.CONFIRM_REQUIRED, timeoutSeconds = 30,
            description = "办理一个待办审批任务（同意/驳回）。产出确认卡（内嵌 AI 摘要/风险 + 后续流转预测），用户确认后才真正办理。"
                    + "参数 taskId、decision(APPROVE|REJECT)、comment 可选。",
            paramsSchema = "{\"taskId\":{\"type\":\"string\",\"description\":\"待办任务 id（可先用 query_todo 获取）\"},"
                    + "\"decision\":{\"type\":\"string\",\"description\":\"APPROVE 同意 / REJECT 驳回\"},"
                    + "\"comment\":{\"type\":\"string\",\"description\":\"办理意见，可选\"}}",
            required = {"taskId", "decision"})
    public ToolResult approveTask(Map<String, Object> args) {
        String decision = String.valueOf(args.getOrDefault("decision", "APPROVE")).toUpperCase();
        boolean reject = "REJECT".equals(decision);
        Map<String, Object> params = new LinkedHashMap<>(args);
        // §7.4 TOCTOU：stage 时快照 Flowable 任务 assignee，确认前比对（任务被办/改派 → AI_ACTION_STALE）
        String taskId = String.valueOf(args.get("taskId"));
        String actionId = stage("approve_task", reject ? "TASK_REJECT" : "TASK_APPROVE", params,
                actionService.snapshotTask(taskId));
        Map<String, Object> card = support.confirmCard(actionId,
                (reject ? "驳回" : "同意") + "审批任务",
                "将" + (reject ? "驳回" : "同意") + "任务 " + taskId
                        + (args.get("comment") != null ? "，意见：" + args.get("comment") : ""),
                params, reject);
        // 亮点⑨：确认卡嵌 AI 摘要+风险（标注仅供参考）；亮点⑩：嵌后续流转预测（失败则省略字段）
        Map<String, Object> aiSummary = insightService.aiSummary(taskId);
        if (aiSummary != null) {
            card.put("aiSummary", aiSummary);
        }
        var predictChain = insightService.predictChain(taskId);
        if (predictChain != null && !predictChain.isEmpty()) {
            card.put("predictChain", predictChain);
        }
        return ToolResult.of(support.toJson(Map.of("staged", true, "actionId", actionId,
                "note", "已生成确认卡，用户确认后才会办理")), card);
    }

    @AiToolDefinition(name = "schedule_prepare_create", aliases = {"create_schedule"},
            risk = AiToolRisk.CONFIRM_REQUIRED,
            description = "创建个人日程。产出确认卡。参数 title、date(yyyy-MM-dd)、type(MEETING|REVIEW|TRIP|TRAINING|OTHER)、startTime?、endTime?、place?。",
            paramsSchema = "{\"title\":{\"type\":\"string\"},\"date\":{\"type\":\"string\",\"description\":\"yyyy-MM-dd\"},"
                    + "\"type\":{\"type\":\"string\"},\"startTime\":{\"type\":\"string\",\"description\":\"HH:mm\"},"
                    + "\"endTime\":{\"type\":\"string\"},\"place\":{\"type\":\"string\"}}",
            required = {"title", "date"})
    public ToolResult createSchedule(Map<String, Object> args) {
        Map<String, Object> params = new LinkedHashMap<>(args);
        String actionId = stage("create_schedule", "SCHEDULE_CREATE", params, null);
        Map<String, Object> card = support.confirmCard(actionId, "创建日程",
                args.get("date") + " " + args.get("title"), params, false);
        return ToolResult.of(support.toJson(Map.of("staged", true, "actionId", actionId)), card);
    }

    @AiToolDefinition(name = "meeting_prepare_create", aliases = {"create_meeting"},
            risk = AiToolRisk.CONFIRM_REQUIRED,
            description = "预订会议。产出确认卡。参数 roomId、subject、date(yyyy-MM-dd)、startHour、endHour（整点小时数）。",
            paramsSchema = "{\"roomId\":{\"type\":\"number\"},\"subject\":{\"type\":\"string\"},"
                    + "\"date\":{\"type\":\"string\",\"description\":\"yyyy-MM-dd\"},"
                    + "\"startHour\":{\"type\":\"number\"},\"endHour\":{\"type\":\"number\"}}",
            required = {"roomId", "subject", "date", "startHour", "endHour"})
    public ToolResult createMeeting(Map<String, Object> args) {
        Map<String, Object> params = new LinkedHashMap<>(args);
        String actionId = stage("create_meeting", "MEETING_CREATE", params, null);
        Map<String, Object> card = support.confirmCard(actionId, "预订会议",
                args.get("date") + " " + args.get("startHour") + ":00-" + args.get("endHour") + ":00 "
                        + args.get("subject"), params, false);
        return ToolResult.of(support.toJson(Map.of("staged", true, "actionId", actionId)), card);
    }

    private String strOrNull(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null || !StringUtils.hasText(String.valueOf(v)) ? null : String.valueOf(v);
    }

    private Long asLong(Object v) {
        return v instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(v));
    }

    private Integer asInt(Object v) {
        return v instanceof Number n ? n.intValue() : Integer.parseInt(String.valueOf(v));
    }
}
