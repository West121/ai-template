package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.AttendanceRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface AttendanceRecordRepository extends JpaRepository<AttendanceRecord, Long> {

    List<AttendanceRecord> findByUserIdAndRecordDateBetweenOrderByRecordDateAsc(Long userId, LocalDate from, LocalDate to);

    Optional<AttendanceRecord> findByUserIdAndRecordDate(Long userId, LocalDate recordDate);
}
