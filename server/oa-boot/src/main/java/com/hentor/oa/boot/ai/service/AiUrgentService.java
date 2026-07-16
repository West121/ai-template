package com.hentor.oa.boot.ai.service;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.office.dto.MeetingResponse;
import com.hentor.oa.office.service.MeetingService;
import com.hentor.oa.workflow.dto.TaskItem;
import com.hentor.oa.workflow.service.WfTaskService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 急事聚合打分（§4 query_urgent）：服务端规则打分排序，LLM 只做呈现（保证优先级一致）。
 * 聚合：待办（超 48h 未办 / 加急标记）+ 今日会议。全部经既有 Service（数据权限生效）。
 * 分数越高越紧急。
 */
@Service
@RequiredArgsConstructor
public class AiUrgentService {

    private final WfTaskService taskService;
    private final MeetingService meetingService;

    public List<Map<String, Object>> urgentItems() {
        List<Scored> scored = new ArrayList<>();

        // 待办：按停留时长打分（>48h 高、>24h 中）
        PageResult<TaskItem> todo = taskService.todo(null, 1, 50);
        OffsetDateTime now = OffsetDateTime.now();
        for (TaskItem t : todo.getList()) {
            long hours = t.createdAt() == null ? 0
                    : java.time.Duration.between(t.createdAt(), now).toHours();
            int score = 40;
            String reason;
            if (hours >= 48) {
                score = 90;
                reason = "待办已滞留 " + hours + " 小时（超 48h）";
            } else if (hours >= 24) {
                score = 65;
                reason = "待办已滞留 " + hours + " 小时";
            } else {
                reason = "待办任务";
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("title", t.instanceTitle() != null ? t.instanceTitle() : t.nodeName());
            item.put("kind", "待办");
            item.put("reason", reason);
            if (t.viewPath() != null) {
                item.put("link", t.viewPath());
            }
            scored.add(new Scored(score, item));
        }

        // 今日会议（临近提醒）
        try {
            PageResult<MeetingResponse> meetings = meetingService.my(1, 50);
            LocalDate today = LocalDate.now();
            for (MeetingResponse m : meetings.getList()) {
                if (today.equals(m.date()) && !"CANCELED".equals(m.status())) {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("title", m.subject());
                    item.put("kind", "会议");
                    item.put("reason", "今日 " + m.startHour() + ":00 " + m.roomName());
                    item.put("link", "/meeting/my");
                    scored.add(new Scored(70, item));
                }
            }
        } catch (Exception ignored) {
            // 会议查询失败不影响急事清单
        }

        scored.sort(Comparator.comparingInt((Scored s) -> s.score).reversed());
        return scored.stream().limit(15).map(s -> s.item).toList();
    }

    private record Scored(int score, Map<String, Object> item) {
    }
}
