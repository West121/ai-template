package com.xingchen.oa.office.service;

import com.xingchen.oa.office.dto.DashboardResponse;
import com.xingchen.oa.office.entity.ApprovalLog;
import com.xingchen.oa.office.entity.AttendanceRecord;
import com.xingchen.oa.office.repository.ApprovalLogRepository;
import com.xingchen.oa.office.repository.AttendanceRecordRepository;
import com.xingchen.oa.office.support.SecuritySupport;
import com.xingchen.oa.office.support.Weeks;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 工作台聚合。
 */
@Service
@RequiredArgsConstructor
public class DashboardService {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
    private static final List<String> STAT_ACTIONS = List.of(ApprovalLog.ACTION_APPROVE, ApprovalLog.ACTION_REJECT);
    private static final Set<String> PRESENT_STATUS = Set.of(
            AttendanceRecord.STATUS_NORMAL, AttendanceRecord.STATUS_LATE, AttendanceRecord.STATUS_EARLY);

    private final ApprovalService approvalService;
    private final MeetingService meetingService;
    private final AnnouncementService announcementService;
    private final ScheduleService scheduleService;
    private final AttendanceRecordRepository attendanceRepository;
    private final ApprovalLogRepository approvalLogRepository;

    public DashboardResponse build() {
        Long userId = SecuritySupport.currentUser().getUserId();
        LocalDate today = LocalDate.now();
        YearMonth month = YearMonth.from(today);

        long monthAttendanceDays = attendanceRepository
                .findByUserIdAndRecordDateBetweenOrderByRecordDateAsc(userId, month.atDay(1), month.atEndOfMonth())
                .stream()
                .filter(r -> PRESENT_STATUS.contains(r.getStatus()))
                .count();
        String todayCheckIn = attendanceRepository.findByUserIdAndRecordDate(userId, today)
                .map(r -> r.getCheckIn() != null ? HH_MM.format(r.getCheckIn()) : null)
                .orElse(null);

        return new DashboardResponse(
                approvalService.pendingCount(),
                meetingService.countTodayInvolved(userId),
                monthAttendanceDays,
                announcementService.unreadCount(),
                todayCheckIn,
                approvalService.page("PENDING", 1, 5).getList(),
                announcementService.page(null, 1, 4).getList(),
                scheduleService.byDate(today),
                weekApprovalStats(today));
    }

    /**
     * 最近 7 天（含今日）APPROVE + REJECT 操作日志计数，缺日补 0，day 为周一~周日中文。
     */
    private List<DashboardResponse.WeekStat> weekApprovalStats(LocalDate today) {
        LocalDate from = today.minusDays(6);
        Map<LocalDate, Long> counts = approvalLogRepository
                .findByActionInAndCreatedAtGreaterThanEqual(STAT_ACTIONS, from.atStartOfDay())
                .stream()
                .collect(Collectors.groupingBy(log -> log.getCreatedAt().toLocalDate(), Collectors.counting()));
        List<DashboardResponse.WeekStat> stats = new ArrayList<>(7);
        for (int i = 0; i < 7; i++) {
            LocalDate day = from.plusDays(i);
            stats.add(new DashboardResponse.WeekStat(Weeks.label(day), counts.getOrDefault(day, 0L)));
        }
        return stats;
    }
}
