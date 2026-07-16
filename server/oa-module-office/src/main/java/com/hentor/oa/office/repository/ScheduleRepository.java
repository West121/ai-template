package com.hentor.oa.office.repository;

import com.hentor.oa.office.entity.Schedule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface ScheduleRepository extends JpaRepository<Schedule, Long> {

    List<Schedule> findByUserIdAndScheduleDateBetweenOrderByScheduleDateAscStartTimeAsc(Long userId, LocalDate from, LocalDate to);

    List<Schedule> findByUserIdAndScheduleDateOrderByStartTimeAsc(Long userId, LocalDate date);
}
