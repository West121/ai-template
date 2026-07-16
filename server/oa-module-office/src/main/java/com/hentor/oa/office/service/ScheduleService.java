package com.hentor.oa.office.service;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.office.dto.ScheduleCreateRequest;
import com.hentor.oa.office.dto.ScheduleResponse;
import com.hentor.oa.office.entity.Schedule;
import com.hentor.oa.office.repository.ScheduleRepository;
import com.hentor.oa.office.support.SecuritySupport;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class ScheduleService {

    private final ScheduleRepository scheduleRepository;

    /**
     * 我的月度日程。
     */
    public List<ScheduleResponse> month(String month) {
        Long userId = SecuritySupport.currentUser().getUserId();
        YearMonth ym = parseMonth(month);
        return scheduleRepository
                .findByUserIdAndScheduleDateBetweenOrderByScheduleDateAscStartTimeAsc(
                        userId, ym.atDay(1), ym.atEndOfMonth())
                .stream()
                .map(this::toResponse)
                .toList();
    }

    /**
     * 指定日期的我的日程（工作台今日日程）。
     */
    public List<ScheduleResponse> byDate(LocalDate date) {
        Long userId = SecuritySupport.currentUser().getUserId();
        return scheduleRepository.findByUserIdAndScheduleDateOrderByStartTimeAsc(userId, date).stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional
    public ScheduleResponse create(ScheduleCreateRequest request) {
        Long userId = SecuritySupport.currentUser().getUserId();
        Schedule schedule = new Schedule();
        schedule.setUserId(userId);
        schedule.setTitle(request.title());
        schedule.setScheduleDate(request.date());
        schedule.setStartTime(request.startTime());
        schedule.setEndTime(request.endTime());
        schedule.setPlace(request.place());
        schedule.setType(request.type());
        return toResponse(scheduleRepository.save(schedule));
    }

    @Transactional
    public void delete(Long id) {
        Long userId = SecuritySupport.currentUser().getUserId();
        Schedule schedule = scheduleRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "日程不存在"));
        if (!Objects.equals(schedule.getUserId(), userId)) {
            throw new BusinessException(403, "仅本人可删除日程");
        }
        scheduleRepository.delete(schedule);
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

    private ScheduleResponse toResponse(Schedule s) {
        return new ScheduleResponse(
                s.getId(), s.getTitle(), s.getScheduleDate(),
                s.getStartTime(), s.getEndTime(), s.getPlace(), s.getType());
    }
}
