package com.hentor.oa.office.controller;

import com.hentor.oa.common.core.R;
import com.hentor.oa.office.dto.AttendanceMonthResponse;
import com.hentor.oa.office.dto.AttendanceRecordResponse;
import com.hentor.oa.office.service.AttendanceService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 考勤（均为当前用户自己的数据）。
 */
@RestController
@RequestMapping("/api/office/attendance")
@RequiredArgsConstructor
public class AttendanceController {

    private final AttendanceService attendanceService;

    /**
     * 月度考勤：summary + list。
     */
    @GetMapping("/records")
    public R<AttendanceMonthResponse> records(@RequestParam(required = false) String month) {
        return R.ok(attendanceService.records(month));
    }

    /**
     * 打卡：无记录 = 签到；有签到无签退 = 签退。
     */
    @PostMapping("/check")
    public R<AttendanceRecordResponse> check() {
        return R.ok(attendanceService.check());
    }
}
