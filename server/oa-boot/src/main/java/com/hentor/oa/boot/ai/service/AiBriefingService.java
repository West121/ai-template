package com.hentor.oa.boot.ai.service;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.office.dto.ApprovalCcResponse;
import com.hentor.oa.office.dto.MeetingResponse;
import com.hentor.oa.office.service.ApprovalService;
import com.hentor.oa.office.service.MeetingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 主动晨报（附3 亮点⑤，批D）：汇总当日待办急事 Top-N（复用 {@link AiUrgentService} 服务端急事排序）+
 * 今日会议 + 未读待阅（抄送），生成置顶简报卡数据。全部经既有 Service（数据权限生效）。
 *
 * <p><b>当日缓存</b>：当日首次生成后按 (userId,date) 缓存，同日再取直接返回（内存实现，单实例）。
 * 编排定时接入留扩展点：{@link #generate}（无缓存强制生成）可由 xxl-job/编排定时流每日晨间调用后
 * 写入用户会话置顶简报卡。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiBriefingService {

    private static final int URGENT_TOP_N = 5;

    private final AiUrgentService urgentService;
    private final MeetingService meetingService;
    private final ApprovalService approvalService;

    /** 当日缓存：userId → (date, payload)。 */
    private final Map<Long, Cached> cache = new ConcurrentHashMap<>();

    private record Cached(LocalDate date, Map<String, Object> payload) {
    }

    /** 当日首次生成、当日缓存（GET /api/ai/briefing）。 */
    public Map<String, Object> briefing() {
        UserContext user = CurrentUserHolder.get();
        Long uid = user == null ? null : user.getUserId();
        LocalDate today = LocalDate.now();
        Cached hit = uid == null ? null : cache.get(uid);
        if (hit != null && today.equals(hit.date())) {
            Map<String, Object> cached = new LinkedHashMap<>(hit.payload());
            cached.put("cached", true);
            return cached;
        }
        Map<String, Object> payload = generate();
        if (uid != null) {
            cache.put(uid, new Cached(today, payload));
        }
        return payload;
    }

    /**
     * 强制生成（不读缓存）——定时编排接入点。前端契约形状：
     * {@code {date, greeting?, urgentCount, meetingCount, unreadCount,
     * items:[{title, kind, featureCode?, routeParams?, path?, meta?}]}}——items 合并急事+会议+待阅，
     * 每项带 featureCode+routeParams 供前端 route-registry 跳转（急事/待阅→WORKFLOW_TASKS，会议→MEETING_MY）。
     */
    public Map<String, Object> generate() {
        LocalDate today = LocalDate.now();
        UserContext user = CurrentUserHolder.get();
        List<Map<String, Object>> items = new ArrayList<>();
        int urgentCount = 0;
        int meetingCount = 0;
        int unreadCount = 0;

        // 急事 Top-N（待办部分；服务端确定性排序，LLM 只呈现）→ WORKFLOW_TASKS
        try {
            for (Map<String, Object> u : urgentService.urgentItems()) {
                if (!"待办".equals(u.get("kind"))) {
                    continue; // 会议由下方今日会议单独汇总，避免重复
                }
                if (urgentCount >= URGENT_TOP_N) {
                    break;
                }
                urgentCount++;
                items.add(item(str(u.get("title")), "待办", "WORKFLOW_TASKS",
                        Map.of(), str(u.get("link")), str(u.get("reason"))));
            }
        } catch (Exception e) {
            log.warn("晨报急事汇总失败: {}", e.getMessage());
        }

        // 今日会议 → MEETING_MY
        try {
            PageResult<MeetingResponse> my = meetingService.my(1, 50);
            for (MeetingResponse m : my.getList()) {
                if (today.equals(m.date()) && !"CANCELED".equals(m.status())) {
                    meetingCount++;
                    items.add(item(m.subject(), "会议", "MEETING_MY",
                            m.id() == null ? Map.of() : Map.of("meetingId", m.id()), "/meeting/my",
                            nz(m.roomName()) + " " + m.startHour() + ":00-" + m.endHour() + ":00"));
                }
            }
        } catch (Exception e) {
            log.warn("晨报会议汇总失败: {}", e.getMessage());
        }

        // 未读待阅（抄送我且未读）→ WORKFLOW_TASKS
        try {
            PageResult<ApprovalCcResponse> cc = approvalService.cc(1, 50);
            for (ApprovalCcResponse c : cc.getList()) {
                if (!Boolean.TRUE.equals(c.readFlag())) {
                    unreadCount++;
                    items.add(item(c.title(), "待阅", "WORKFLOW_TASKS",
                            c.id() == null ? Map.of() : Map.of("approvalId", c.id()), "/workflow/tasks",
                            "抄送人 " + nz(c.applicant())));
                }
            }
        } catch (Exception e) {
            log.warn("晨报待阅汇总失败: {}", e.getMessage());
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("date", today.toString());
        payload.put("greeting", greeting(user));
        payload.put("generatedAt", java.time.OffsetDateTime.now().toString());
        payload.put("urgentCount", urgentCount);
        payload.put("meetingCount", meetingCount);
        payload.put("unreadCount", unreadCount);
        payload.put("items", items);
        payload.put("cached", false);
        return payload;
    }

    /** 简报项：featureCode+routeParams 供前端 route-registry 跳转；path 兜底；meta 放原因/明细。 */
    private Map<String, Object> item(String title, String kind, String featureCode,
                                     Map<String, Object> routeParams, String path, String meta) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("title", title);
        o.put("kind", kind);
        o.put("featureCode", featureCode);
        o.put("routeParams", routeParams == null ? Map.of() : routeParams);
        if (path != null) {
            o.put("path", path);
        }
        if (meta != null) {
            o.put("meta", meta);
        }
        return o;
    }

    /** 时段问候 + 用户名。 */
    private String greeting(UserContext user) {
        int h = java.time.LocalTime.now().getHour();
        String g = h < 6 ? "凌晨好" : h < 12 ? "上午好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
        String name = user == null ? null : (user.getName() != null ? user.getName() : user.getUsername());
        return name != null ? g + "，" + name : g;
    }

    private String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    private String nz(String s) {
        return s == null ? "" : s;
    }
}
