package com.xingchen.oa.office.dto;

import java.util.List;

/**
 * 月度考勤：汇总 + 明细。
 */
public record AttendanceMonthResponse(
        Summary summary,
        List<AttendanceRecordResponse> list
) {

    public record Summary(
            long days,
            long late,
            long early,
            long absent,
            double overtimeHours
    ) {
    }
}
