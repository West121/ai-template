package com.hentor.oa.office.service;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.office.dto.AttendanceMonthResponse;
import com.hentor.oa.office.dto.AttendanceRecordResponse;
import com.hentor.oa.office.entity.AttendanceRecord;
import com.hentor.oa.office.repository.AttendanceRecordRepository;
import com.hentor.oa.office.support.SecuritySupport;
import com.hentor.oa.office.support.Weeks;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class AttendanceService {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
    private static final LocalTime WORK_START = LocalTime.of(9, 0);
    /** 标准出勤时长（含午休），超出部分计入加班。 */
    private static final double STANDARD_HOURS = 9.0;
    private static final Set<String> PRESENT_STATUS = Set.of(
            AttendanceRecord.STATUS_NORMAL, AttendanceRecord.STATUS_LATE, AttendanceRecord.STATUS_EARLY);

    private final AttendanceRecordRepository recordRepository;

    /**
     * 我的月度考勤：明细 + 汇总。
     */
    public AttendanceMonthResponse records(String month) {
        Long userId = SecuritySupport.currentUser().getUserId();
        YearMonth ym = parseMonth(month);
        List<AttendanceRecord> records = recordRepository
                .findByUserIdAndRecordDateBetweenOrderByRecordDateAsc(userId, ym.atDay(1), ym.atEndOfMonth());

        long days = records.stream().filter(r -> PRESENT_STATUS.contains(r.getStatus())).count();
        long late = records.stream().filter(r -> AttendanceRecord.STATUS_LATE.equals(r.getStatus())).count();
        long early = records.stream().filter(r -> AttendanceRecord.STATUS_EARLY.equals(r.getStatus())).count();
        long absent = records.stream().filter(r -> AttendanceRecord.STATUS_ABSENT.equals(r.getStatus())).count();
        double overtime = records.stream()
                .filter(r -> r.getHours() != null && r.getHours() > STANDARD_HOURS)
                .mapToDouble(r -> r.getHours() - STANDARD_HOURS)
                .sum();

        return new AttendanceMonthResponse(
                new AttendanceMonthResponse.Summary(days, late, early, absent, round1(overtime)),
                records.stream().map(this::toResponse).toList());
    }

    /**
     * 打卡：当日无记录 → 签到（09:00 后判迟到）；已签到未签退 → 签退并计算时长。
     */
    @Transactional
    public AttendanceRecordResponse check() {
        Long userId = SecuritySupport.currentUser().getUserId();
        LocalDate today = LocalDate.now();
        LocalTime now = LocalTime.now().withSecond(0).withNano(0);

        AttendanceRecord record = recordRepository.findByUserIdAndRecordDate(userId, today).orElse(null);
        if (record == null) {
            record = new AttendanceRecord();
            record.setUserId(userId);
            record.setRecordDate(today);
            record.setCheckIn(now);
            record.setStatus(now.isAfter(WORK_START) ? AttendanceRecord.STATUS_LATE : AttendanceRecord.STATUS_NORMAL);
        } else if (record.getCheckIn() != null && record.getCheckOut() == null) {
            record.setCheckOut(now);
            double hours = Duration.between(record.getCheckIn(), now).toMinutes() / 60.0;
            record.setHours(round1(Math.max(hours, 0)));
        } else {
            throw new BusinessException(400, "今日打卡已完成");
        }
        return toResponse(recordRepository.save(record));
    }

    private YearMonth parseMonth(String month) {
        if (!StringUtils.hasText(month)) {
            return YearMonth.now();
        }
        try {
            return YearMonth.parse(month);
        } catch (DateTimeParseException e) {
            throw new BusinessException(400, "月份格式不正确，应为 yyyy-MM");
        }
    }

    private AttendanceRecordResponse toResponse(AttendanceRecord record) {
        return new AttendanceRecordResponse(
                record.getRecordDate(),
                Weeks.label(record.getRecordDate()),
                record.getCheckIn() != null ? HH_MM.format(record.getCheckIn()) : null,
                record.getCheckOut() != null ? HH_MM.format(record.getCheckOut()) : null,
                record.getHours(),
                record.getStatus());
    }

    private double round1(double value) {
        return Math.round(value * 10) / 10.0;
    }
}
