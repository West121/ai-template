package com.xingchen.oa.office.dto;

import java.util.List;

/**
 * 工作台聚合。
 */
public record DashboardResponse(
        long pendingCount,
        long todayMeetings,
        long monthAttendanceDays,
        long unreadAnnouncements,
        /** 今日签到时间 HH:mm，未签到为 null */
        String todayCheckIn,
        List<ApprovalResponse> pendingList,
        List<AnnouncementResponse> announcements,
        List<ScheduleResponse> todaySchedules,
        List<WeekStat> weekApprovalStats
) {

    public record WeekStat(
            String day,
            long count
    ) {
    }
}
