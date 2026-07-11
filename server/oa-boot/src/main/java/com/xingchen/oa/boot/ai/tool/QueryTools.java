package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.service.AiStatsService;
import com.xingchen.oa.boot.ai.service.AiUrgentService;
import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.office.dto.LeaveQuotaResponse;
import com.xingchen.oa.office.dto.MeetingResponse;
import com.xingchen.oa.office.dto.gongwen.GongwenListItem;
import com.xingchen.oa.office.service.AttendanceService;
import com.xingchen.oa.office.service.GongwenService;
import com.xingchen.oa.office.service.LeaveService;
import com.xingchen.oa.office.service.MeetingService;
import com.xingchen.oa.workflow.dto.InstanceListItem;
import com.xingchen.oa.workflow.dto.TaskItem;
import com.xingchen.oa.workflow.service.InstanceService;
import com.xingchen.oa.workflow.service.WfTaskService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 只读查询工具（§4）：全部包装既有 Service —— @PreAuthorize 与 JPA 数据权限天然生效。
 * 无权限时底层抛异常 → ToolRegistry 转 error 数据帧，助手礼貌解释。
 */
@Component
@RequiredArgsConstructor
public class QueryTools {

    private final AiToolSupport support;
    private final WfTaskService taskService;
    private final InstanceService instanceService;
    private final GongwenService gongwenService;
    private final MeetingService meetingService;
    private final LeaveService leaveService;
    private final AttendanceService attendanceService;
    private final AiUrgentService urgentService;
    private final AiStatsService statsService;

    @AiToolDefinition(name = "task_query_my_tasks", aliases = {"query_todo"},
            description = "查询我的待办任务（审批/公文办理）。参数 keyword 可选（标题/流程名过滤）。",
            paramsSchema = "{\"keyword\":{\"type\":\"string\",\"description\":\"可选，标题或流程名关键词\"}}")
    public ToolResult queryTodo(Map<String, Object> args) {
        String keyword = str(args, "keyword");
        PageResult<TaskItem> page = taskService.todo(keyword, 1, 10);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (TaskItem t : page.getList()) {
            Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("title", t.instanceTitle());
            row.put("node", t.nodeName());
            row.put("flow", t.defName());
            row.put("initiator", t.initiatorName());
            if (t.viewPath() != null) {
                row.put("link", t.viewPath());
            }
            rows.add(row);
        }
        Map<String, Object> card = support.listCard("我的待办（" + page.getTotal() + "）",
                List.of(support.col("title", "标题"), support.col("node", "环节"),
                        support.col("flow", "流程"), support.col("initiator", "发起人")),
                rows, "/workflow/tasks");
        return ToolResult.of(support.toJson(Map.of("total", page.getTotal(), "items", rows)), card);
    }

    @AiToolDefinition(name = "workflow_query_my_instances", aliases = {"query_my_instances"},
            description = "查询我发起的流程实例。参数 status 可选、keyword 可选。",
            paramsSchema = "{\"status\":{\"type\":\"string\",\"description\":\"可选，如 RUNNING/APPROVED/REJECTED\"},"
                    + "\"keyword\":{\"type\":\"string\",\"description\":\"可选，标题关键词\"}}")
    public ToolResult queryMyInstances(Map<String, Object> args) {
        PageResult<InstanceListItem> page = instanceService.my(str(args, "keyword"), 1, 10);
        List<Map<String, Object>> rows = new ArrayList<>();
        String status = str(args, "status");
        for (InstanceListItem i : page.getList()) {
            if (status != null && !status.equalsIgnoreCase(i.bizStatus())) {
                continue;
            }
            rows.add(m("title", nz(i.title()), "flow", nz(i.defName()), "status", nz(i.bizStatus())));
        }
        Map<String, Object> card = support.listCard("我发起的流程",
                List.of(support.col("title", "标题"), support.col("flow", "流程"), support.col("status", "状态")),
                rows, "/workflow/start");
        return ToolResult.of(support.toJson(Map.of("items", rows)), card);
    }

    @AiToolDefinition(name = "document_query_mine", aliases = {"query_documents"},
            description = "查询公文列表（收文/发文）。参数 direction(RECEIVE|SEND) / status / keyword 均可选。",
            paramsSchema = "{\"direction\":{\"type\":\"string\",\"description\":\"RECEIVE 收文 / SEND 发文\"},"
                    + "\"keyword\":{\"type\":\"string\",\"description\":\"标题或文号关键词\"}}")
    public ToolResult queryDocuments(Map<String, Object> args) {
        PageResult<GongwenListItem> page = gongwenService.list(str(args, "direction"), str(args, "status"),
                null, null, null, str(args, "keyword"), null, null, 1, 10);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (GongwenListItem d : page.getList()) {
            String path = "SEND".equals(d.direction()) ? "/document/send/" + d.id() : "/document/receive/" + d.id();
            rows.add(m("code", nz(d.code()), "title", nz(d.title()),
                    "type", nz(d.docType()), "status", nz(d.status()), "link", path));
        }
        Map<String, Object> card = support.listCard("公文列表（" + page.getTotal() + "）",
                List.of(support.col("code", "文号"), support.col("title", "标题"),
                        support.col("type", "文种"), support.col("status", "状态")),
                rows, "/document/ledger");
        return ToolResult.of(support.toJson(Map.of("total", page.getTotal(), "items", rows)), card);
    }

    @AiToolDefinition(name = "meeting_query", aliases = {"query_meetings"},
            description = "查询我的会议（我组织或参与的）。无参数。")
    public ToolResult queryMeetings(Map<String, Object> args) {
        PageResult<MeetingResponse> page = meetingService.my(1, 10);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (MeetingResponse mt : page.getList()) {
            rows.add(m("subject", nz(mt.subject()), "room", nz(mt.roomName()),
                    "date", String.valueOf(mt.date()), "time", mt.startHour() + ":00-" + mt.endHour() + ":00",
                    "status", nz(mt.status())));
        }
        Map<String, Object> card = support.listCard("我的会议",
                List.of(support.col("subject", "主题"), support.col("room", "会议室"),
                        support.col("date", "日期"), support.col("time", "时段"), support.col("status", "状态")),
                rows, "/meeting/my");
        return ToolResult.of(support.toJson(Map.of("items", rows)), card);
    }

    @AiToolDefinition(name = "leave_query_balance", aliases = {"query_leave_balance"},
            description = "查询我的假期额度（各类型总额/已用/剩余）。无参数。")
    public ToolResult queryLeaveBalance(Map<String, Object> args) {
        List<LeaveQuotaResponse> quotas = leaveService.quotas();
        List<Map<String, Object>> rows = new ArrayList<>();
        for (LeaveQuotaResponse q : quotas) {
            double remain = (q.total() == null ? 0 : q.total()) - (q.used() == null ? 0 : q.used());
            rows.add(m("type", nz(q.type()), "total", q.total(), "used", q.used(), "remain", remain));
        }
        Map<String, Object> card = support.listCard("假期额度",
                List.of(support.col("type", "类型"), support.col("total", "总额"),
                        support.col("used", "已用"), support.col("remain", "剩余")),
                rows, "/attendance/leave");
        return ToolResult.of(support.toJson(Map.of("quotas", rows)), card);
    }

    @AiToolDefinition(name = "attendance_query_month", aliases = {"query_attendance"},
            description = "查询我的月度考勤汇总。参数 month 可选（yyyy-MM，缺省本月）。",
            paramsSchema = "{\"month\":{\"type\":\"string\",\"description\":\"yyyy-MM，缺省本月\"}}")
    public ToolResult queryAttendance(Map<String, Object> args) {
        var resp = attendanceService.records(str(args, "month"));
        var s = resp.summary();
        Map<String, Object> summary = Map.of("出勤天数", s.days(), "迟到", s.late(),
                "早退", s.early(), "缺勤", s.absent(), "加班时长", s.overtimeHours());
        Map<String, Object> card = support.listCard("本月考勤汇总",
                List.of(support.col("k", "项"), support.col("v", "值")),
                summary.entrySet().stream().<Map<String, Object>>map(e -> Map.of("k", e.getKey(), "v", e.getValue())).toList(),
                "/attendance/record");
        return ToolResult.of(support.toJson(summary), card);
    }

    @AiToolDefinition(name = "urgent_query_mine", aliases = {"query_urgent"},
            description = "筛选我当前最该处理的急事（服务端按超时/加急/催办/待阅/今日会议打分排序）。无参数。")
    public ToolResult queryUrgent(Map<String, Object> args) {
        List<Map<String, Object>> items = urgentService.urgentItems();
        List<Map<String, Object>> rows = items.stream().<Map<String, Object>>map(i -> {
            Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("title", i.get("title"));
            row.put("kind", i.get("kind"));
            row.put("reason", i.get("reason"));
            if (i.get("link") != null) {
                row.put("link", i.get("link"));
            }
            return row;
        }).toList();
        Map<String, Object> card = support.listCard("急事清单（按优先级）",
                List.of(support.col("title", "事项"), support.col("kind", "类型"), support.col("reason", "原因")),
                rows, null);
        return ToolResult.of(support.toJson(Map.of("count", rows.size(), "items", items)), card);
    }

    // 批B：管理侧统计报表以 office:approval:approve 门控（批C 报表目录 report_catalog 细化到按 reportCode 授权）
    @AiToolDefinition(name = "report_execute", aliases = {"stats_report"},
            authorities = {"office:approval:approve"},
            description = "统计报表（服务端预置聚合，带数据权限）。module=approval|document|attendance；"
                    + "dimension 按 module：approval→status|type，document→docType。返回图表数据。",
            paramsSchema = "{\"module\":{\"type\":\"string\",\"description\":\"approval|document|attendance\"},"
                    + "\"dimension\":{\"type\":\"string\",\"description\":\"approval:status|type；document:docType\"}}",
            required = {"module"})
    public ToolResult statsReport(Map<String, Object> args) {
        String module = str(args, "module");
        String dimension = str(args, "dimension");
        AiStatsService.StatResult r = statsService.report(module, dimension);
        List<Map<String, Object>> series = List.of(Map.of("name", r.metric(), "data", r.data()));
        Map<String, Object> card = "pie".equals(r.chartType())
                ? support.chartCard("pie", r.title(), r.categories(), pieSeries(r))
                : support.chartCard(r.chartType(), r.title(), r.categories(), series);
        return ToolResult.of(support.toJson(Map.of("title", r.title(),
                "categories", r.categories(), "data", r.data())), card);
    }

    /** pie：series 数据项带 name/value/percent（§10）。 */
    private List<Map<String, Object>> pieSeries(AiStatsService.StatResult r) {
        double total = r.data().stream().mapToDouble(Number::doubleValue).sum();
        List<Map<String, Object>> data = new ArrayList<>();
        for (int i = 0; i < r.categories().size(); i++) {
            double v = r.data().get(i).doubleValue();
            data.add(Map.of("name", r.categories().get(i), "value", v,
                    "percent", total > 0 ? Math.round(v / total * 1000) / 10.0 : 0));
        }
        return List.of(Map.of("name", r.metric(), "data", data));
    }

    private String str(Map<String, Object> args, String key) {
        Object v = args.get(key);
        return v == null || !StringUtils.hasText(String.valueOf(v)) ? null : String.valueOf(v).trim();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> m(Object... kv) {
        Map<String, Object> row = new java.util.LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            row.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return row;
    }

    private String nz(String s) {
        return s == null ? "" : s;
    }
}
