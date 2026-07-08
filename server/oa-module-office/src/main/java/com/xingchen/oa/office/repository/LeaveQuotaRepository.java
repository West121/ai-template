package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.LeaveQuota;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface LeaveQuotaRepository extends JpaRepository<LeaveQuota, Long> {

    List<LeaveQuota> findByUserIdOrderByIdAsc(Long userId);
}
