package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.Schedule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface ScheduleRepository extends JpaRepository<Schedule, Long> {

    List<Schedule> findByUserIdAndScheduleDateBetweenOrderByScheduleDateAscStartTimeAsc(Long userId, LocalDate from, LocalDate to);

    List<Schedule> findByUserIdAndScheduleDateOrderByStartTimeAsc(Long userId, LocalDate date);
}
